# Cloudflare voice runtime

The voice runtime is a Cloudflare Worker built on `agents/voice`. **Each call
runs in its own Durable Object** (one DO per `${agentId}~${callId}`), with Sarvam
STT/TTS and a per-agent LLM. Convex is the control plane and the system of
record.

```text
Browser
  ├─ calls.start (Convex) ──► call row + per-call token
  └─ useVoiceAgent (WebSocket, 16 kHz mono PCM, ?token=)
       └─ SarvamVoiceAgent  (Durable Object, one per call)
            ├─ SarvamSttSession  ──► Saaras v4
            ├─ onTurn()          ──► selected LLM (+ tools)
            ├─ SarvamTtsProvider ──► Bulbul
            └─ event batches     ──► Convex /webhooks/voice (HMAC signed)
                                      calls · callTurns · callEvents · callUsage
```

## Files

```text
apps/voice-runtime/
├── src/worker.ts        # Worker entry + agent routing
├── src/agent.ts         # withVoice agent: call lifecycle, turns, event stream
├── src/guard.ts         # transcript echo filter + reply de-duplication
├── src/tools.ts         # declarative HTTP tools -> AI SDK tools
├── src/models.ts        # provider registry
├── src/config.ts        # per-call config lookup
├── src/sync.ts          # signed event-batch sync
└── src/env.ts           # runtime types

packages/sarvam/
├── src/stt.ts           # streaming STT session
├── src/tts.ts           # Bulbul adapter (reports synthesis metrics)
├── src/languages.ts     # language/mode/model enums
└── src/audio.ts         # base64, PCM, WAV helpers
```

## Call lifecycle

1. The builder saves a new immutable `agentVersions` row and publishes it with
   `agents.publish`.
2. **`calls.start`** (Convex mutation) mints `callId`, a per-call capability
   token, the `calls` row (`status: "queued"`, `agentVersionId`, `lastSeq: 0`)
   and a `callSessions` row holding only the token's SHA-256 hash.
3. The browser connects to `/agents/SarvamVoiceAgent/<agentId>~<callId>` with
   `?token=<token>`. `useVoiceAgent` passes it via `query`.
4. `beforeCallStart()` reads `connection.uri`, then fetches
   `GET /voice/config?callId=&token=` — authenticated by the token, not by a
   shared runtime secret.
5. The DO builds Sarvam STT/TTS from that version and creates its own SQLite
   conversation table. Concurrent calls can never share history.
6. While the call runs, the DO batches events (`call.started`, `turn.appended`,
   `transcript.rejected`, `sentence.dropped`, `tool.called`, `tool.result`,
   `call.ended`) and posts an HMAC-signed batch to `/webhooks/voice` about once a
   second.
7. `voiceWebhook.ingest` applies the batch in `seq` order, dedupes by
   `deliveryId`, and upserts `callUsage`.
8. A five-minute cron sweeps calls whose runtime disappeared and marks them
   `failed` with `endedReason: "runtime-lost"`.

## Data model

| Table           | Purpose                                                         |
| --------------- | --------------------------------------------------------------- |
| `calls`         | Aggregate root: status, transcript, agent version, `lastSeq`    |
| `callTurns`     | Ordered turns (`seq`), the source of truth for transcripts      |
| `callEvents`    | Domain audit: guard drops, tool calls, status, errors           |
| `callUsage`     | Metering: turns, STT ms, TTS chars, tokens, first-audio latency |
| `callSessions`  | Per-call capability tokens (hashed)                             |
| `webhookEvents` | Raw delivery audit for replay; never queried for domain data    |

Invariants enforced in `voiceWebhook.ingest`:

- A delivery is idempotent by `deliveryId`.
- Events at or below the call's `lastSeq` are skipped, so retries cannot
  duplicate turns.
- A terminal call (`ended` / `failed`) never regresses to an active status.
- Sparse updates never clear richer data.

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

## Tools

Agents can call tools mid-turn. A tool is a declarative HTTPS endpoint, the same
contract Vapi uses for server-URL tools:

```ts
tools: [
  {
    name: "check_availability",
    description: "Check appointment slots for a doctor and date.",
    parameters: {
      type: "object",
      properties: { doctor: { type: "string" }, date: { type: "string" } },
      required: ["doctor", "date"],
    },
    endpoint: "https://api.example.com/voice/check-availability",
    secret: "optional-bearer-token",
  },
];
```

The runtime POSTs
`{ callId, agentId, workspaceId, tool, arguments }` with `x-call-id`,
`x-agent-id`, `x-workspace-id` headers, times out after 10 s, records
`tool.called` / `tool.result` events, and feeds the JSON result back to the
model. Endpoints must be `https` (plain `http` only for localhost). Tool loops
are capped at four model steps.

The reply guard is tool-aware: a turn that ends in a tool call with no text
speaks a short acknowledgment instead of the "जी, बताइए?" fallback.

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

It is used only to sign event batches (`HMAC-SHA256(timestamp.body)`); it is no
longer sent to `/voice/config`.

## Local development

```bash
bun run dev:all           # web 3001 + Convex + voice runtime 3011
```

Point the web app at the local runtime:

```env
VITE_VOICE_RUNTIME_URL=http://localhost:3011
```

Then open `/sarvam/agents`, create an agent, choose **Use Sarvam stack**, publish, and
click **Test call**.

## Deployment

```bash
bun run deploy:voice
```

The stack prints the Worker URL. Set `VITE_VOICE_RUNTIME_URL` to that URL in
`apps/web/.env` and redeploy web with `bun run deploy:web`.

## Conversation quality

Repeating greetings had four causes, all now handled structurally:

1. **Cross-call history leaks.** Previously one Durable Object served every call
   for an agent, so `spoken[]`, `callId` and the SQLite conversation table were
   shared between callers. Calls are now DO-scoped by `callId`; there is no
   reset hack and concurrent callers cannot collide.
2. **Reconnects replay the greeting.** PartySocket re-sends `start_call` after
   every reconnect. The DO is already configured for that call, so it resumes
   and greets once (`greeted` flag).
3. **Noise becomes a turn.** Short fragments from background noise or TTS bleed
   back ("आप।", "मैं।", "Up.") are dropped in `afterTranscribe()` and recorded as
   `transcript.rejected` events.
4. **The model re-emits canned lines.** `guardReplyStream()` strips leading
   greetings, "how can I help" lines, unprompted self-introductions, and any
   sentence already spoken in the call. Drops are recorded as
   `sentence.dropped` events with a rule name, so a repetition bug is a query in
   `callEvents` instead of a lost console line.

Per-agent endpointing lives in `config.turnTaking` (`endpointingMs`,
`highVadSensitivity`); the defaults stay at 500 ms with VAD sensitivity off so
one sentence is not split into several turns.

## Observability

- The voice page shows a **Latency** card driven by the SDK's per-turn
  `VoiceTurnMetrics`: reply latency (finalized transcript → first server audio),
  STT finalization, model first token, TTS first audio, turn total, and a
  rolling history of the last 12 turns. All values are measured server-side in
  the Durable Object on one clock; browser playback and network transit are
  excluded.
- It also shows the runtime's own metering from `callUsage` (`firstAudioMs`,
  `llmMs`, `ttsMs`, TTS characters, tokens), which lands in Convex about once a
  second while the call runs. This survives the call; the in-memory turn
  history does not.
- `Start → call active` on the same card covers mint, socket connect, token
  exchange, and config load, so a slow cold start is visible separately from a
  slow reply.
- `callSessions` and `calls.agentVersionId` make it possible to attribute a
  quality change to a specific publish.
- `calls.get` returns turns, events and usage for the call detail page, which
  repeats the persisted timings after the call ends.

### Pointing the web app at a deployed runtime

`apps/web/.env` must match where the runtime actually runs:

```env
# deployed Worker (copy the URL printed by `bun run deploy:voice`)
VITE_VOICE_RUNTIME_URL=https://convex-vapi-voice-runtime-<hash>.<account>.workers.dev

# local emulator (bun run dev:infra:voice)
VITE_VOICE_RUNTIME_URL=http://localhost:3011
```

A `ws://localhost:3011` failure in the browser console means the web app is
still pointing at the local emulator. Vite reads env at startup, so restart the
dev server after changing it. The Worker answers `/healthz`.

## Current limits

- Browser audio uses WebSocket, not WebRTC. Add Cloudflare Realtime SFU if
  WebRTC, jitter buffering, or echo cancellation becomes necessary.
- TTS uses Sarvam's REST endpoint. Switching to Sarvam streaming TTS is the next
  latency improvement.
- Telephony is not wired yet. `calls.phoneNumber` / `customerNumber` are reserved
  for the Twilio/Plivo adapters.
- `tools` has no builder UI yet; it is set through the config/copilot payload.
- `agents/voice` is Beta. Pin the `agents` package version.
