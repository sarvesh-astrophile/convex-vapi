# Cloudflare voice runtime

The voice runtime is a Cloudflare Worker built on `agents/voice`. Each call runs
in a Durable Object with Sarvam STT/TTS and a per-agent LLM.

```text
Browser
  └─ useVoiceAgent (WebSocket, 16 kHz mono PCM)
       └─ SarvamVoiceAgent (Durable Object)
            ├─ SarvamSttSession  ──► Saaras v4
            ├─ onTurn()          ──► selected LLM
            ├─ SarvamTtsProvider ──► Bulbul
            └─ call end          ──► Convex /webhooks/voice
```

## Files

```text
apps/voice-runtime/
├── src/worker.ts        # Worker entry + agent routing
├── src/agent.ts         # withVoice agent, onTurn, call sync
├── src/models.ts        # provider registry
├── src/config.ts        # Convex config lookup
├── src/sync.ts          # call-end sync
└── src/env.ts           # runtime types

packages/sarvam/
├── src/stt.ts           # streaming STT session
├── src/tts.ts           # Bulbul adapter
├── src/languages.ts     # language/mode/model enums
└── src/audio.ts         # base64, PCM, WAV helpers
```

## Configuration flow

1. The builder saves a new immutable `agentVersions` row in Convex and publishes
   it with `agents.publish`.
2. The browser opens `/voice?agent=<id>`.
3. `useVoiceAgent` connects to
   `/agents/sarvam-voice-agent/<agent-id>`.
4. `beforeCallStart()` fetches
   `GET /voice/config?agentId=<id>` from Convex with `x-voice-secret`.
5. The Durable Object builds Sarvam STT/TTS clients for that version.
6. On call end, the DO posts turns and metadata to `POST /webhooks/voice`.

## LLM selection

`agentVersions.config.model` is the source of truth:

```ts
model: {
  provider: "sarvam" | "openai" | "anthropic" | "cloudflare-gateway";
  model: string;
  temperature: number;
  maxTokens: number;
}
```

`src/models.ts` resolves it:

| Provider             | Implementation                                           |
| -------------------- | -------------------------------------------------------- |
| `sarvam`             | OpenAI-compatible endpoint at `https://api.sarvam.ai/v1` |
| `openai`             | `@ai-sdk/openai`                                         |
| `anthropic`          | `@ai-sdk/anthropic`                                      |
| `cloudflare-gateway` | OpenAI-compatible gateway base URL                       |

Changing the model requires saving and publishing a new version. The runtime
loads the published config at call start.

### OpenAI through Cloudflare AI Gateway

Add the gateway URL and optional auth token to `packages/infra-voice/.env`:

```env
CLOUDFLARE_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/compat
OPENAI_API_KEY=...
# optional, for an authenticated gateway
CLOUDFLARE_AI_GATEWAY_TOKEN=...
```

Then set the agent model:

```json
{
  "provider": "cloudflare-gateway",
  "model": "openai/gpt-4o-mini",
  "temperature": 0.4,
  "maxTokens": 220
}
```

The runtime calls the gateway's OpenAI-compatible `/compat` endpoint, adds
`cf-aig-authorization` when a token is configured, and uses the OpenAI key as
the provider credential. The builder has a **Cloudflare AI Gateway** preset.

If the gateway uses **BYOK** (stored keys), leave `OPENAI_API_KEY` empty. The
runtime removes the provider `Authorization` header and relies on
`CLOUDFLARE_AI_GATEWAY_TOKEN` plus the stored key.

If you use the provider-specific `/openai` endpoint instead, set the model to
`gpt-4o-mini` and drop the `openai/` prefix.

## Environment

`packages/infra-voice/.env`:

```env
SARVAM_API_KEY=...
VOICE_SYNC_SECRET=...
CONVEX_SITE_URL=https://<deployment>.convex.site
```

The same `VOICE_SYNC_SECRET` must be set on the Convex deployment:

```bash
cd packages/backend
bunx convex env set VOICE_SYNC_SECRET "<value>"
```

## Local development

```bash
bun run dev:infra:voice   # voice runtime on 3011
bun run dev:web           # web app on 3001
```

Point the web app at the local runtime:

```env
VITE_VOICE_RUNTIME_URL=http://localhost:3011
```

Then open `/agents`, create an agent, choose **Use Sarvam stack**, publish, and
click **Test call**.

## Deployment

```bash
bun run deploy:voice
```

The stack prints the Worker URL. Set `VITE_VOICE_RUNTIME_URL` to that URL in
`apps/web/.env` and redeploy web with `bun run deploy:web`.

## Current limits

- Browser audio uses WebSocket, not WebRTC. Add Cloudflare Realtime SFU if
  WebRTC, jitter buffering, or echo cancellation becomes necessary.
- TTS uses Sarvam's REST endpoint. Switching to Sarvam streaming TTS is the next
  latency improvement.
- Telephony is not wired yet. Twilio/Plivo adapters are the planned Phase 3
  work.
- `agents/voice` is Beta. Pin the `agents` package version.
