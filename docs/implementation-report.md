# Implementation report

Date: 2026-10-29
Repository: `/home/sarveshk/projects/ai-test`

## 1. Implemented

### Delivered

- Bun workspace monorepo (`apps/web`, `workers/realtime`, `packages/shared`,
  root `convex/`).
- **Convex**: schema, Convex Auth password provider, ownership indexes,
  agent CRUD, call listing/read, transcript read, one-time ticket issuance,
  signed runtime HTTP actions (`/runtime/session`, `/runtime/events`), event
  ingestion with sequence checks + idempotency, nonce replay protection, stale
  call reconciler cron.
- **TanStack Start web app**: sign-in/up, agent list/editor, embedded voice
  tester, call history, call detail/transcript page, error/loading states,
  unsaved-change signal, fixed provider labels.
- **Browser audio**: AudioWorklet capture at 16 kHz (with streaming resampler),
  fixed 20 ms PCM16 frames, AudioWorklet playback at 24 kHz (with resampler),
  bounded queue, generation-aware stale-audio rejection, immediate local
  barge-in clear, VAD, live/committed transcript feed, latency metrics.
- **Realtime Worker**: Origin/upgrade/path validation, one Durable Object per
  call, 5 s auth deadline, opaque ticket auth through Convex, call state
  machine, generation IDs, AbortControllers, Deepgram/OpenRouter/Sarvam adapters,
  phrase chunking, binary audio framing, backpressure limits, call timeouts,
  graceful/failed teardown, outbox retries + DO storage recovery.
- **Tests**: 79 Vitest tests across shared contracts, audio framing/resampling,
  phrase chunking, runtime HMAC compatibility, provider adapters with fake
  sockets, turn manager/cancellation, event buffer/outbox, session state,
  Convex ownership/tickets/event ingestion/nonce replay.
- **Docs/scripts**: README, architecture, integration notes, operations,
  benchmark template, E2E harness, auth key generator, deployment smoke test,
  `.env.example` files.

### Files and modules of note

- `packages/shared/src/audio-protocol.ts` — tested 16-byte binary header.
- `packages/shared/src/protocol.ts` / `events.ts` — Zod discriminated unions.
- `packages/shared/src/phrase-chunker.ts` — punctuation/Devanagari-safe chunker.
- `packages/shared/src/runtime-auth.ts` — HMAC/canonical request contract.
- `workers/realtime/src/VoiceSession.ts` — Durable Object orchestration.
- `workers/realtime/src/turn-manager.ts` / `pipeline.ts` — generation/abort and
  LLM→TTS streaming.
- `workers/realtime/src/providers/*` — Deepgram, OpenRouter, Sarvam adapters.
- `workers/realtime/src/event-buffer.ts` — retrying bounded outbox.
- `apps/web/src/audio/*` — capture/playback worklets, resampling, queue.
- `apps/web/src/lib/voice-client.ts` — browser protocol + barge-in.
- `convex/agents.ts`, `convex/calls.ts`, `convex/runtime.ts`, `convex/http.ts`.

### Architecture differences from the plan

1. **No `runtimeEvents` table.** The plan marked it optional. Idempotency is
   provided by `calls.lastEventSeq` plus unique transcript indexes on `eventId`
   and `(callId, turnId)`. All meaningful events are still delivered through
   `/runtime/events`.
2. **Sarvam socket per assistant response.** The plan allowed keeping one socket
   or re-establishing after barge-in. A fresh socket per generation is used so
   closing it cannot leak old audio; the handshake overlaps the OpenRouter request.
3. **No STT reconnect loop.** An abnormal Deepgram close fails the call with
   `stt_disconnected`. The plan allowed "reconnect once or fail".
4. **Sarvam completion fallback.** Completion events are expected per flushed
   phrase; if a deployment coalesces them, a 1.5 s quiet-period fallback after
   `finish()` completes the turn. A 30 s hard timeout still applies.
5. **Convex `_generated` files are checked in** and were produced from the
   installed Convex codegen templates because no deployment/login was available
   in the build environment. Running `bunx convex dev`/`convex codegen` with a
   real deployment regenerates them normally.
6. **Agents CRUD lives in `convex/agents.ts`** (not mixed into `calls.ts`), so
   `api.agents.*` matches the plan and tests.
7. **Provider selection is fixed**, not a dropdown. M7's capability manifest is
   implemented as a verified catalog (`packages/shared/src/agent-config.ts`) and
   the UI only shows implemented providers/languages/voices.

## 2. How to run

Exact commands and environment variables are in `README.md`. Short version:

```bash
bun install
bunx convex dev                    # configure a deployment; leave running
bun run auth:keys                  # set JWT_PRIVATE_KEY + JWKS in Convex
bunx convex env set RUNTIME_SHARED_SECRET "$(openssl rand -hex 32)"
cp workers/realtime/.dev.vars.example workers/realtime/.dev.vars
cp apps/web/.env.example apps/web/.env.local
# Fill provider keys, CONVEX_HTTP_URL, RUNTIME_SHARED_SECRET, VITE_* values.
bun run dev
```

Then open `http://localhost:3000`, sign up, create an agent and press Talk.

Deployment order and secret setup are in `README.md` and
`docs/operations.md`.

## 3. Tests

Commands run and results in this environment:

```text
bun run typecheck        PASS (shared, realtime, web, convex)
bun run test             PASS — 16 files, 79 tests
bun run lint             PASS
bun run format:check     PASS
bun --cwd=apps/web run build       PASS (Vite build + tsc)
bun --cwd=workers/realtime run build  PASS (wrangler deploy --dry-run)
```

Live checks (2026-10-29, real credentials):

- **Provider smoke PASS**: OpenRouter `openai/gpt-4o-mini` returned `READY`;
  Sarvam English (`simran_en_customer`, 99,000 bytes raw PCM) and Hindi
  (`aparna_hi_customer`, 79,200 bytes) synthesized successfully with one
  completion event per flush; Deepgram transcribed the synthesized English
  question exactly. Total wall time 18,686 ms for the whole smoke (not latency).
- **Headless 2-turn Worker E2E PASS**: real Convex session ticket → workerd
  Worker → Deepgram → OpenRouter → Sarvam → binary PCM output. Two user finals,
  two assistant turns, context retained, 384,000 bytes of output audio.
  Server timings are recorded in `docs/benchmark-results.md`.
- **Browser Playwright E2E BLOCKED**: Chromium exists but `libnspr4.so` and other
  system libraries are missing; installing them requires sudo, which is not
  available here.
- `wrangler dev` `/health` returned 200; a WebSocket upgrade without an allowed
  Origin returned 403; `vite preview` served the SSR shell.

Three real Worker bugs were found and fixed by the live run:

1. `fetch` stored as an object property caused workerd “Illegal invocation”;
   adapters and the Convex bridge now wrap `fetch` calls.
2. Workerd rejects `wss://` URLs in `fetch` upgrade requests; provider upgrade
   URLs now use `https://` with `Upgrade: websocket`.
3. `Date.now() & 0xffffffff` produced signed values and failed the uint32 frame
   check; timestamps now use `>>> 0`.

Coverage highlights:

- Binary frame round-trip/byte layout/malformed rejection.
- Phrase chunker punctuation, Devanagari danda, long text, ordering.
- Agent schema rejects unsupported providers/models/language/voice combos.
- Shared↔Convex catalog and HMAC implementations stay in sync.
- Deepgram partial/final/UtteranceEnd/SpeechStarted/close/auth failure.
- OpenRouter streaming deltas, malformed SSE, auth error, cancellation.
- Sarvam config/text/flush, base64 audio, final event, error, abnormal close.
- Event buffer ack/retry/conflict/outbox restart/gap behavior.
- Turn manager generation invalidation and cancellation.
- Convex ownership isolation, unauthenticated rejection, ticket one-time use,
  expiry, event idempotency, out-of-order application, terminal-state safety,
  nonce replay.
- Resampling and fixed-frame assembly.

**Run:** real provider smoke and a headless 2-turn Worker E2E. **Not run:**
deployed staging, browser microphone/AudioWorklet playback, barge-in on real
devices, or the 20-turn/10-interruption benchmark. The Playwright harness was
attempted but blocked by missing Chromium system libraries. Per the plan,
unfinished live verification is not reported as success.

## 4. Latency

Preliminary real-provider server timings from the 2-turn headless run:

| Turn | End of turn → LLM first delta | End of turn → first TTS audio | End of turn → LLM done |
| ---- | ----------------------------: | ----------------------------: | ---------------------: |
| 1    |                       2708 ms |                       5289 ms |                2786 ms |
| 2    |                       2937 ms |                       4920 ms |                2951 ms |

The <1,000 ms target was **not met**. There are only two samples, so no P50/P95
is claimed. Browser end-of-turn → audible playback and barge-in clear latency
were not measured because the browser E2E could not run. See
`docs/benchmark-results.md` for the environment and caveats.

## 5. Security verification

Implemented and unit-tested:

- All user-facing Convex reads/writes call `requireOwner`; tests prove one user
  cannot list/read/update another owner's agent, and unauthenticated reads throw.
- Tickets: 256-bit random, SHA-256 hash stored, 60 s TTL, one-time use; tests
  cover wrong/expired/replayed tickets.
- Worker→Convex HMAC: timestamp skew, path/body tampering, nonce replay; shared
  and Convex implementations are tested against each other.
- Origin allowlist at gateway and DO.
- No provider keys in `VITE_*` variables or Convex docs.
- No raw audio/token/partial transcript persistence.
- Logs omit prompts, transcripts, tickets and keys.
- Queue/frame/call/turn/token limits.

Not verified here: a deployed bundle secret scan, CSP headers, live credential
rotation, and abuse/rate-limit behavior under load. Add CSP/rate limiting before
a public launch (see `docs/operations.md`).

## 6. Known limits

- **No live provider verification.** First real call may reveal account-specific
  model/voice access issues, Sarvam `linear16` behavior, or Workers outbound
  header behavior.
- English STT uses Deepgram `en` (not `en-IN`) for verified Nova-3 monolingual
  support; Sarvam still receives `en-IN`.
- Monolingual per call; no code-switching STT.
- Only two Sarvam voices are shipped (`simran_en_customer`,
  `aparna_hi_customer`); no voice browser.
- Assistant interrupted turns store generated-to-date text, not exact audio
  alignment.
- No active-call reconnect; DO restart/eviction ends the call and Convex
  reconciles it.
- Deepgram abnormal close fails the call rather than reconnecting.
- `runtimeEvents` table omitted; only calls + transcript turns + structured logs
  are durable.
- Convex Auth password reset/email verification is not wired.
- No CSP/rate limiting at the edge yet.
- No recording storage, telephony, tools, RAG, failover, billing, or BYOK UI.
- Web build emits a Vite CSS sourcemap warning (cosmetic).

## 7. Next work

Only after a real baseline call succeeds:

1. Run the 20-turn/10-interruption benchmark on staging and record honest P50/P95
   plus barge-in clear times.
2. Validate Sarvam `linear16` and completion-event cardinality; if needed, keep
   the WAV normalizer path and document the exact provider behavior.
3. Add edge rate limiting + CSP and a per-owner spend cap.
4. Add one bounded Deepgram reconnect attempt while buffering <1 s of audio.
5. Add browser/device matrix tests (headphones vs speakers, mobile Safari).
6. Revisit provider placement/latency only with measured evidence.
