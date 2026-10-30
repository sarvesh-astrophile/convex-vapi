# Architecture

## Ownership boundaries

| Concern                                                         | Owner                                |
| --------------------------------------------------------------- | ------------------------------------ |
| Users, sessions, agents, calls, final transcript turns, tickets | Convex                               |
| Web app and audio engine                                        | TanStack Start on Cloudflare Workers |
| Authenticated WebSocket ingress, origin checks                  | Realtime Cloudflare Worker           |
| Live call state, provider sockets, generation IDs, outbox       | `VoiceSession` Durable Object        |
| Provider API keys                                               | Cloudflare Worker secrets            |
| Signed machine-to-machine requests                              | HMAC shared secret (Convex + Worker) |

Convex is never called per audio frame, token or audio packet. A call loads one
frozen `agentSnapshot` at initialization. The browser talks directly to the
realtime Worker.

## Request and session flow

```text
Browser                      Convex                       Realtime Worker / DO
  │                            │                                  │
  ├─ calls.createSession ─────►│                                  │
  │                            ├─ auth + agent ownership          │
  │                            ├─ insert call(status=created)     │
  │                            ├─ store SHA-256(ticket), TTL 60s  │
  │◄──── {callId, ticket} ─────┤                                  │
  │                                                               │
  ├─ WSS /v1/calls/{callId} ─────────────────────────────────────►│
  │   first message: {type:'auth', ticket}                        │
  │                                                               ├─ verify Origin
  │                                                               ├─ POST /runtime/session
  │                                                               │   (HMAC + nonce)
  │                                                               ├─ authorizeSession:
  │                                                               │   ticket match + TTL
  │                                                               │   status created→active
  │                                                               ├─ connect Deepgram
  │◄──── session.ready ───────────────────────────────────────────┤
  │                                                               │
  ├─ binary PCM16 input frames ──────────────────────────────────►├─ Deepgram
  │                                                               │
  │◄──── transcript.partial/final ────────────────────────────────┤
  │                                                               ├─ OpenRouter stream
  │◄──── assistant.text_delta ────────────────────────────────────┤
  │                                                               ├─ Sarvam stream
  │◄──── binary PCM16 output frames ──────────────────────────────┤
  │                                                               │
  ├─ client.interrupt / client.playback_done ────────────────────►│
  │                                                               │
  │◄──── session.ended ───────────────────────────────────────────┤
```

The session ticket is opaque, one-use and valid for 60 seconds. Only its hash is
stored. Convex atomically checks the hash/TTL and transitions the call from
`created` to `active`.

## WebSocket protocol

Control frames are JSON validated with Zod in `packages/shared/src/protocol.ts`.

Client:

- `auth` (ticket)
- `session.start` (protocol v1, PCM16 16 kHz mono)
- `session.stop`
- `client.playback_done` (generation ID)
- `client.interrupt` (generation ID)
- `client.ping`

Server:

- `session.ready` (call ID, PCM16 24 kHz mono)
- `session.state` (connecting/listening/thinking/speaking/interrupting/closing/closed)
- `transcript.partial`
- `transcript.final` (stable turn ID)
- `assistant.text_delta`
- `assistant.turn_end` (text, interrupted flag, timings)
- `playback.clear` (generation ID)
- `session.error` (safe code, retryable, message)
- `session.ended`
- `pong`

Audio is binary. Header layout is documented and unit-tested in
`packages/shared/src/audio-protocol.ts`:

```text
u8 version | u8 kind | u16 reserved | u32 generationId |
u32 sequence | u32 timestampMs | PCM16LE payload
```

The header is big-endian; PCM payload is little-endian. Moving the 16-byte header
and payload in one `ArrayBuffer` avoids base64 overhead.

## Session state machine

```text
CONNECTING ─► LISTENING ─► THINKING ─► SPEAKING
                  ▲            │           │
                  │            ▼           ▼
                  └──── INTERRUPTING ◄─────┘
                               │
                               ▼
                           LISTENING
CLOSING ─► CLOSED
```

Invalid transitions throw in development and are guarded in the Durable Object.
`SessionStateMachine` is unit-tested.

## Turn detection

- Deepgram sends interim and final results with `interim_results=true`,
  `vad_events=true`, `endpointing=300`, `utterance_end_ms=1000`.
- Final text accumulates until `speech_final` or `UtteranceEnd`.
- A configurable grace (`TURN_GRACE_MS`, default 400 ms) prevents every final
  fragment from starting a separate LLM turn. A new interim result cancels the
  pending commit.
- Only committed final user text triggers the LLM.

## Response pipeline and generations

1. User turn ends → persist/send `transcript.final` → state `THINKING`.
2. The turn manager increments `generationId` and starts one OpenRouter request with
   an `AbortController`.
3. OpenRouter deltas go to the browser immediately and into `PhraseChunker`.
4. Phrases are sent to Sarvam as `text` frames; each phrase is flushed. The
   Sarvam socket is opened in parallel with the OpenRouter request so handshake
   latency overlaps generation.
5. Sarvam `audio` messages are base64-decoded, stripped of any WAV container,
   and sent as generation-tagged binary output frames.
6. On completion the server sends `assistant.turn_end`; the browser sends
   `client.playback_done` when the worklet queue drains. Only then does the
   server return to `LISTENING`.

Every packet carries a generation ID. On barge-in:

- the browser clears its worklet queue synchronously and drops old generations;
- the server aborts OpenRouter, closes Sarvam, increments/invalidates the
  generation, sends `playback.clear`, and persists the generated-so-far
  assistant text as `interrupted: true`;
- late text/audio for the old generation is ignored.

Assistant text is persisted as generated-to-date when interrupted. It is not
claimed to be exactly what the user heard.

## Barge-in detection

Two independent signals:

1. **Client energy VAD** (primary): while the server state is `speaking`, four
   consecutive 20 ms frames above RMS `0.05` trigger a local clear and
   `client.interrupt`. A 300 ms warm-up and 900 ms cooldown reduce false
   triggers.
2. **Committed user speech** (server): a finalized user turn committed while the
   assistant is `thinking` or `speaking` interrupts the old generation and starts
   the next one.

Deepgram's `SpeechStarted` VAD event is no longer a barge-in trigger. It fires on
ambient noise and speaker echo, and it aborted replies while the assistant was
still thinking (before any audio existed). Providers still emit the event, but
the session ignores it.

Browser capture requests `echoCancellation: true` and `noiseSuppression: true`.
Speaker echo can still cause false triggers; test with headphones first.

## Convex event delivery

The Durable Object batches meaningful events:

- `call.started`
- `transcript.final` (user/assistant, interrupted flag)
- `call.ended`
- `call.failed`

It posts signed batches to `/runtime/events`. Convex validates:

- HMAC, timestamp, nonce (single-use table);
- call existence;
- contiguous sequence numbers (`lastEventSeq + 1`);
- transcript size and turn IDs;
- duplicate `eventId` and `(callId, turnId)`.

On failure the outbox retries with exponential backoff. A bounded copy is stored
in Durable Object storage as **transport recovery state**, never business truth.
After a restart the DO replays the outbox; if it cannot, Convex's scheduled
reconciler marks the call `failed` with `stale_session`/`session_expired`.

`runtimeEvents` is intentionally not implemented in this MVP. Idempotency is
provided by `calls.lastEventSeq` plus transcript indexes on `eventId` and
`(callId, turnId)`, which is sufficient for the four event types above.

## Concurrency and limits

- One WebSocket client per Durable Object; a second is rejected with HTTP 409.
- Max call duration 10 minutes (alarm-enforced).
- Max 60 turns per call.
- Max 220 LLM output tokens per turn.
- Input frames ≤ 8 KB; inbound budget 96 KB/s.
- Outbound pause if the browser reports > 1 MB buffered; browser queue cap 4 s.
- Event outbox cap 100 events.
- Two recent calls per owner (`created`/`active` within 15 minutes).

## Failure policy

| Failure                        | Behavior                                                       |
| ------------------------------ | -------------------------------------------------------------- |
| Microphone denied              | No call created; actionable UI message                         |
| Convex unavailable before call | Call creation fails; no socket                                 |
| Convex unavailable during call | Realtime continues; outbox retries; cron reconciles            |
| Deepgram disconnect            | Typed `stt_disconnected`; call fails (no silent recovery)      |
| OpenRouter error/timeout       | Typed error; generation aborted; call fails                    |
| Sarvam error/timeout           | Typed error; TTS closed; call fails                            |
| User barge-in                  | Immediate local clear; provider work aborted                   |
| Browser disconnect             | `failed` / `client_disconnected`                               |
| DO restart                     | Client gets an error; no seamless recovery; Convex reconciles  |
| Slow playback                  | Bounded queue; backpressure error rather than unbounded memory |

## Deployment topology

Two independently deployable Workers plus Convex:

- `voice-agent-web` — TanStack Start, `app.example.com`
- `voice-agent-realtime` — WSS gateway + `VoiceSession` DO, `voice.example.com`
- Convex deployment — `.convex.cloud` (client) and `.convex.site` (HTTP actions)

Use separate dev/staging/prod secrets and deployments. Cloudflare Durable Object
hibernation does not apply while outgoing provider WebSockets are open.
