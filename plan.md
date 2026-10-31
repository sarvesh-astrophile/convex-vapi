# Migration plan: Cloudflare `agents/voice` + Sarvam

**Status:** Implemented. Vapi and the Vapi–Sarvam bridge have been removed.
The runtime is `apps/voice-runtime`, the shared Sarvam clients are in
`packages/sarvam`, and the Alchemy stack is `packages/infra-voice`.

**Last updated:** 2026-10-30  
**Goal:** run voice agents on a Cloudflare Worker/Durable Object using Sarvam
for STT/TTS and a per-agent, selectable LLM.

---

## 1. Decision summary

- **Target runtime:** Cloudflare `agents/voice` (`withVoice(Agent)`), one
  Durable Object per call.
- **STT:** Sarvam Saaras v4 through a custom `Transcriber` adapter.
- **TTS:** Sarvam Bulbul through a custom `TTSProvider` / `StreamingTTSProvider`
  adapter.
- **LLM:** selectable per agent (`sarvam`, `openai`, `anthropic`, `workers-ai`,
  `cloudflare-gateway`). The LLM is only called inside `onTurn()`.
- **Control plane:** Convex stays the source of truth for workspaces, agents,
  versions, configs, publish state, call records, and analytics.
- **Data plane:** the Durable Object owns live audio, turn detection, the LLM
  call, TTS, and the live transcript; it syncs the finished call to Convex.
- **Vapi:** removed. The Cloudflare runtime replaced it after the local end-to-end
  test passed.
- **Bridge:** removed. Its Sarvam clients moved to `packages/sarvam`.

**Historical note:** the phased rollout below was the original staging plan. The
Vapi path, bridge app, and bridge Alchemy stack have since been deleted.

---

## 2. Current architecture (as-is)

```text
Browser
  └─ /voice (apps/web/src/routes/voice.tsx)
       └─ use-vapi-call.ts
            └─ Vapi Web SDK ── WebRTC ── Vapi
                                         ├─ transcriber: custom-transcriber
                                         │    └─ apps/sarvam-bridge ── Sarvam Saaras
                                         ├─ voice: custom-voice
                                         │    └─ apps/sarvam-bridge ── Sarvam Bulbul
                                         ├─ LLM: Vapi-configured model
                                         └─ webhook ── Convex /webhooks/vapi
```

Relevant files:

| Area               | File                                                   |
| ------------------ | ------------------------------------------------------ |
| Voice UI           | `apps/web/src/routes/voice.tsx`                  |
| Vapi client hook   | `apps/web/src/hooks/use-vapi-call.ts`                  |
| Builder            | `apps/web/src/components/agent-form.tsx`               |
| Agent config       | `packages/backend/convex/lib/agentConfig.ts`           |
| Agent CRUD/publish | `packages/backend/convex/agents.ts`                    |
| Vapi REST client   | `packages/backend/convex/vapi/client.ts`               |
| Vapi webhook       | `packages/backend/convex/vapiWebhook.ts`, `http.ts`    |
| Calls              | `packages/backend/convex/calls.ts`, `schema.ts`        |
| Sarvam bridge      | `apps/sarvam-bridge/`                                  |
| Infra              | `packages/infra-web/`, `packages/infra-sarvam-bridge/` |

---

## 3. Target architecture (to-be)

```text
Browser
  └─ /voice (useVoiceAgent)
       └─ WebSocket (16 kHz mono PCM)
            └─ Cloudflare Worker + VoiceAgent Durable Object
                 ├─ SarvamTranscriber ──► Sarvam Saaras v4
                 ├─ onTurn() ───────────► selected LLM
                 ├─ SarvamTTS ──────────► Sarvam Bulbul
                 ├─ SQLite transcript
                 └─ call-end ──► Convex /webhooks/voice

Phone
  └─ Twilio / Plivo ──► telephony adapter ──► same VoiceAgent DO
```

Convex remains responsible for:

- workspaces and membership
- agents, immutable versions, drafts, publish state
- runtime + model + voice configuration
- call list/detail, turns, analytics, cost metadata
- the builder UI and copilot

---

## 4. New packages and apps

### 4.1 `packages/sarvam/`

Shared, dependency-light Sarvam clients. Used by both the legacy Vapi bridge and
the new Cloudflare runtime.

```text
packages/sarvam/
├── src/
│   ├── stt.ts          # streaming STT client
│   ├── tts.ts          # streaming + REST TTS
│   ├── languages.ts    # language/speaker/mode enums
│   ├── audio.ts        # base64, PCM, WAV helpers
│   └── index.ts
└── package.json
```

Requirements:

- STT: WebSocket to `wss://api.sarvam.ai/speech-to-text/ws`.
- `feed(pcm16kMono)` and final/interim callbacks.
- 300–400 ms debounce for per-phrase finals.
- Reconnect on `1006`/`1011`; fatal on `4xxx`.
- TTS: prefer streaming WebSocket, fall back to REST.
- No Vapi, Convex, or Cloudflare imports.

### 4.2 `apps/voice-runtime/`

```text
apps/voice-runtime/
├── src/
│   ├── worker.ts              # routes + DO export
│   ├── agent.ts               # SarvamVoiceAgent extends withVoice(Agent)
│   ├── transcriber.ts         # SarvamTranscriber implements Transcriber
│   ├── tts.ts                 # SarvamTTS implements TTSProvider
│   ├── models.ts              # LLM registry + resolveModel()
│   ├── config.ts              # load/cache agent config from Convex
│   ├── sync.ts                # call-end sync to Convex
│   └── telephony/             # Phase 3: twilio.ts, plivo.ts
└── package.json
```

`onTurn()` sketch:

```ts
async onTurn(transcript, context) {
  const config = await this.getAgentConfig();
  const result = streamText({
    model: resolveModel(config.model, this.env),
    system: config.systemPrompt,
    messages: [
      ...context.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: transcript },
    ],
    tools: buildTools(config),
    abortSignal: context.signal,
  });
  return result.textStream;
}
```

### 4.3 `packages/infra-voice/`

Independent Alchemy stack, same pattern as `infra-sarvam-bridge`:

- `Cloudflare.Worker("voice-runtime")`
- Durable Object export `SarvamVoiceAgent`
- AI binding if Workers AI models are used
- secrets: `SARVAM_API_KEY`, `VOICE_SYNC_SECRET`, optional provider keys

Add root scripts:

```bash
bun run dev:infra:voice
bun run deploy:voice
bun run destroy:voice
```

### 4.4 Web app changes

- Add `apps/web/src/hooks/use-cloudflare-voice.ts` (thin wrapper around
  `useVoiceAgent` from `agents/voice/react`).
- Update `voice.tsx` to choose the transport by the selected agent's `runtime`.
- Keep the existing call layout, transcript, mute, and end-call UI.
- Add a runtime badge and an LLM badge.
- Builder (`agent-form.tsx`):
  - runtime selector: Vapi / Cloudflare
  - LLM provider + model picker
  - Sarvam STT preset (language, mode, keyterms)
  - Sarvam TTS preset (language, speaker, model)
  - publish/test-call links point at `/voice?agent=<id>`

---

## 5. Convex changes

### 5.1 Schema

Additive only; existing rows default to Vapi.

```ts
agents: defineTable({
  // ...existing
  runtime: v.optional(v.union(v.literal("vapi"), v.literal("cloudflare"))),
  publishedRuntime: v.optional(v.union(v.literal("vapi"), v.literal("cloudflare"))),
  cloudflareAgentName: v.optional(v.string()),
});

calls: defineTable({
  // ...existing
  runtime: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  modelProvider: v.optional(v.string()),
  modelName: v.optional(v.string()),
});
```

No new tables for live transcripts; `callTurns` already fits.

### 5.2 Publish flow

`agents.publish` branches on `agent.runtime`:

- `vapi`: existing `buildVapiPayload` + `createVapiAssistant` /
  `updateVapiAssistant`.
- `cloudflare`: validate config, mark the version published, and return the
  Convex `agentId`/`versionId`. No Vapi call.

Keep `vapiAssistantId` optional and untouched for Vapi agents.

### 5.3 Config endpoint

Add an internal HTTP route or Convex HTTP action:

```text
GET /voice/config?agentId=<id>&version=<n>
Header: x-voice-secret
```

Returns the published version config plus workspace ID. The DO caches it in
SQLite keyed by `agentId:version`, so calls do not depend on Convex latency.

### 5.4 Call sync

Add `POST /webhooks/voice`:

```json
{
  "callId": "cf_...",
  "agentId": "...",
  "workspaceId": "...",
  "runtime": "cloudflare",
  "startedAt": 0,
  "endedAt": 0,
  "endedReason": "customer-ended-call",
  "model": { "provider": "sarvam", "model": "sarvam-105b" },
  "turns": [{ "role": "user", "text": "...", "at": 0 }]
}
```

Requirements:

- HMAC or `x-voice-secret` auth.
- Idempotent by `callId`; dedupe turns by `callTurns.key`.
- Reuse the call upsert logic from `vapiWebhook.ts` where possible; extract a
  shared helper instead of duplicating merge rules.
- No live streaming required in Phase 1; sync at call end.

---

## 6. LLM selection design

### 6.1 Config shape

Reuse `config.model`:

```ts
model: {
  provider: "sarvam" | "openai" | "anthropic" | "workers-ai" | "cloudflare-gateway";
  model: string;
  temperature: number;
  maxTokens: number;
}
```

### 6.2 Registry

`apps/voice-runtime/src/models.ts` maps provider → AI SDK model:

| Provider             | Implementation                                       | Notes                                                        |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `sarvam`             | OpenAI-compatible client, `https://api.sarvam.ai/v1` | `api-subscription-key` header; disable reasoning for latency |
| `openai`             | `@ai-sdk/openai`                                     | tools supported                                              |
| `anthropic`          | `@ai-sdk/anthropic`                                  | tools supported                                              |
| `workers-ai`         | `workers-ai-provider`                                | use only tool-capable models                                 |
| `cloudflare-gateway` | OpenAI-compatible gateway base URL                   | caching/observability                                        |

### 6.3 Per-agent selection

- Stored in Convex with the agent version.
- Loaded by the DO at call start and cached.
- Changing the model requires publishing a new version.
- The builder shows a capability label: `tools`, `streaming`, `reasoning`.

### 6.4 Guardrails

- Reject a model that cannot stream for voice agents.
- Reject/flag a model that lacks tool calling when the agent has tools.
- Disable reasoning modes for realtime voice unless explicitly chosen.
- `onTurn` must return a stream, not a fully buffered string, whenever possible.

---

## 7. Environment and secrets

| Location                    | Variable                 | Purpose                   |
| --------------------------- | ------------------------ | ------------------------- |
| `packages/infra-voice/.env` | `SARVAM_API_KEY`         | STT/TTS                   |
|                             | `VOICE_SYNC_SECRET`      | Worker → Convex call sync |
|                             | `OPENAI_API_KEY`         | optional                  |
|                             | `ANTHROPIC_API_KEY`      | optional                  |
| Convex deployment           | `VOICE_SYNC_SECRET`      | verify call sync          |
|                             | `CLOUDFLARE_VOICE_URL`   | builder test links        |
| `apps/web/.env`             | `VITE_VOICE_RUNTIME_URL` | browser WebSocket host    |
|                             | `VITE_VOICE_AGENT`       | default agent/DO name     |

Browser must never receive `SARVAM_API_KEY` or provider keys.

---

## 8. Phases

### Phase 0 — Web spike (3–5 days)

**Scope**

- `packages/sarvam` STT/TTS clients.
- `apps/voice-runtime` with one hardcoded agent:
  - Sarvam STT `unknown`/`codemix`
  - Sarvam TTS `hi-IN`, `shubh`
  - Sarvam-105B via `onTurn`
- Local Alchemy stack on port 3011.
- A throwaway `/voice-cloudflare` route using `useVoiceAgent`.

**Acceptance**

- 10 real browser calls.
- Live transcripts and spoken replies.
- Interruption stops playback.
- No unhandled DO errors.
- Record TTFA and turn latency.

### Phase 1 — Convex control plane (1 week)

- Schema additions (`runtime`, model metadata).
- Config fetch endpoint + DO cache.
- Call-end sync + idempotency.
- Builder runtime/model/Sarvam presets.
- Publish branch for `cloudflare`.
- Call detail shows runtime and model.

**Acceptance**

- Create, publish, and call a Cloudflare agent entirely from the builder.
- Call appears in Convex with turns and model metadata.
- Vapi agents still work unchanged.

### Phase 2 — Web cutover (1 week)

- Runtime flag default for new agents.
- `/voice` selects transport per agent.
- Side-by-side benchmark: Vapi vs Cloudflare, 50 calls.
- Fix latency, VAD, interruption, and audio issues.

**Cutover gate**

- TTFA p50 ≤ 900 ms, p95 ≤ 1.5 s.
- Dropped/failed calls < 2%.
- Interruption handling ≥ 95%.
- No regression in transcript quality or tool calling.
- Convex call sync idempotent under retries.

### Phase 3 — Telephony (1–2 weeks)

- Twilio or Plivo adapter (choose one first).
- Number table in Convex: workspace, provider, number, agent, status.
- 8 kHz μ-law ↔ 16 kHz PCM conversion.
- Inbound calls first; outbound second.
- Recordings and DTMF/transfers only if required.

**Acceptance**

- Inbound call to a provisioned number reaches the same agent.
- Audio is clear in both directions.
- Call record synced to Convex.
- Fallback path documented.

### Phase 4 — Decommission Vapi (after 2 stable weeks)

- Remove `runtime: "vapi"` default for new agents.
- Delete `use-vapi-call.ts` and `@vapi-ai/web`.
- Remove Vapi branch from `agents.publish`, `vapi/client.ts`,
  `vapiWebhook.ts`, and `/webhooks/vapi`.
- Remove `VITE_VAPI_*` from `apps/web` and `infra-web`.
- Archive or delete `apps/sarvam-bridge` and `infra-sarvam-bridge`.
- Update `docs/voice-agent-builder.md`, `docs/vapi-voice-agent.md`, README,
  AGENTS.md.

---

## 9. Benchmark matrix

Run the same prompt, tools, and 50 recorded calls on both runtimes.

| Dimension | Cases                                               |
| --------- | --------------------------------------------------- |
| Language  | Hindi, English, Hinglish, one Dravidian language    |
| Audio     | clean mic, phone 8 kHz, background noise, far-field |
| Turns     | short answers, long monologue, interruptions        |
| Tools     | no tool, one lookup tool, failing tool              |
| Network   | good Wi-Fi, throttled/lossy                         |

Metrics:

- time-to-first-audio (p50/p95)
- end-of-turn latency
- word error rate against reference transcripts
- interruption success rate
- dropped/failed calls
- tool-call success rate
- cost per minute (platform + Sarvam + LLM + telephony)

---

## 10. Risks and mitigations

| Risk                          | Mitigation                                                               |
| ----------------------------- | ------------------------------------------------------------------------ |
| `agents/voice` is Beta        | Pin `agents` version; wrap imports in one module; keep Vapi fallback     |
| Browser WebSocket vs WebRTC   | Test on lossy networks; add Cloudflare Realtime SFU later if needed      |
| Sarvam TTS latency/format     | Use streaming TTS; enforce 16 kHz mono PCM; telephony needs PCM, not MP3 |
| Sarvam STT turn segmentation  | 300–400 ms debounce; tune VAD; expose `maxTurnSilence` equivalents       |
| Model lacks tool calling      | Capability check in registry; block publish or warn                      |
| Telephony provider complexity | Start with one provider; isolate adapter; keep Vapi numbers until proven |
| Dual-write inconsistency      | Sync at call end only; idempotency key; dedupe turns                     |
| DO duration cost              | Measure per-call duration; set max call length; monitor                  |
| Vendor lock-in                | Keep Convex control plane and model registry provider-agnostic           |

### Rollback

- Per-agent `runtime` flag switches back to `vapi` without a deploy.
- Keep Vapi assistants, webhook, and bridge deployed until Phase 4.
- Keep the Cloudflare worker deployed but dark if rolling back.

---

## 11. Open decisions

1. Default LLM: Sarvam-105B or GPT-4.1-mini?
2. Telephony provider: Twilio, Plivo, or Sarvam-rented numbers?
3. Is WebRTC required for browser calls, or is WebSocket acceptable?
4. Do we need recordings, DTMF, transfers, and compliance features in v1?
5. Sarvam chat endpoint: `/v1/chat/completions` or `/v2/chat/completions`
   (v2 requires beta access)?
6. Do we mirror call turns live, or only sync at call end?

---

## 12. Definition of done

- A new agent can be built, versioned, and published with:
  - Cloudflare runtime
  - Sarvam STT and TTS
  - any supported LLM
- Browser and phone calls reach the same agent.
- Calls, turns, model metadata, and outcomes appear in Convex.
- Vapi code paths are removed or clearly marked legacy.
- `bun run check` passes, both Alchemy stacks deploy independently, and the
  rollback path is documented.

---

## 13. References

- Cloudflare Voice: https://developers.cloudflare.com/agents/agent-class/communication-channels/voice/
- Cloudflare Agents: https://developers.cloudflare.com/agents/
- Sarvam streaming STT: https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/streaming-api
- Sarvam streaming TTS: https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/streaming-api/web-socket
- Sarvam chat completions: https://docs.sarvam.ai/api-reference/chat/chat-completions-v2
- Current bridge: `docs/sarvam-stt-bridge.md`
