# Sarvam STT/TTS bridge (Cloudflare Worker)

Vapi has no built-in Sarvam provider, so Sarvam runs through Vapi's custom
interfaces: `custom-transcriber` for speech-to-text and `custom-voice` for
text-to-speech.

```text
Vapi ──wss──► /v1/transcriber ──wss──► Sarvam Saaras v4
Vapi ──https─► /v1/voice       ──https─► Sarvam Bulbul v3
                  │
                  └── one Durable Object per call (transcriber only)
```

Both endpoints share one Worker, one Sarvam key, and one set of bridge secrets.
The model, call webhooks, and storage still live in Vapi and Convex.

## Why a Durable Object

A call needs two long-lived sockets in the same place: Vapi's inbound audio
socket and Sarvam's outbound socket. A normal Worker isolate can disappear
between requests, and Cloudflare's WebSocket hibernation cannot preserve an
outbound socket. A Durable Object gives each call a single-threaded home for
both sockets for the duration of the call.

The object is intentionally ephemeral: it holds no storage and is left to be
evicted after the call ends.

## Files

```text
apps/sarvam-bridge/
├── package.json
├── tsconfig.json
├── src/
│   ├── audio.ts       # stereo split + base64 PCM
│   ├── protocol.ts    # URL params, validation, HMAC signing
│   └── worker.ts      # Worker routes + SarvamSession Durable Object
└── scripts/
    ├── sign-url.ts       # build a signed transcriber URL
    ├── sign-voice-url.ts # build a signed voice URL
    └── stream-wav.ts     # push a WAV/TTS sample through the bridge
```

The bridge has its own Alchemy stack in
`packages/infra-sarvam-bridge/alchemy.run.ts`; the web stack stays in
`packages/infra-web`. They share no resources or state.

## Endpoint contract

```text
wss://<worker-host>/v1/transcriber
  ?agent=<agent-id>
  &lang=hi-IN
  &mode=codemix
  &channels=customer
  &keyterms=Sarvam,EMI
  &sig=<hmac-sha256-hex>
```

- `agent`: 1–128 chars, `[A-Za-z0-9:_-]`. Used for logs and DO naming.
- `lang`: a Sarvam language code (`unknown` auto-detects).
- `mode`: `transcribe`, `codemix`, `translit`, `translate`, or `verbatim`.
- `channels`: `customer` (default) or `both`.
- `keyterms`: comma-separated, max 50 terms, 64 chars each. Terms cannot
  contain commas.
- `sig`: HMAC-SHA256 of the canonical payload, hex encoded.

Canonical payload (newline-separated):

```text
v1
<agent>
<lang>
<mode>
<channels>
<keyterms joined by comma>
```

Vapi also sends `server.secret` as the `x-vapi-secret` header. The bridge
compares it to `SARVAM_BRIDGE_SECRET` before reading query params.

`/healthz` returns `{ "ok": true }` without auth.

## Voice contract

```text
POST https://<worker-host>/v1/voice
  ?agent=<agent-id>
  &lang=hi-IN
  &speaker=shubh
  &model=bulbul:v3
  &sig=<hmac-sha256-hex>
```

Vapi sends its standard custom-voice payload:

```json
{
  "message": {
    "type": "voice-request",
    "text": "Hello, how can I help?",
    "sampleRate": 24000
  }
}
```

The bridge calls Sarvam Bulbul, strips the WAV header, and returns headerless
16-bit mono PCM with `Content-Type: application/octet-stream` at exactly the
requested sample rate. `lang=unknown` is rejected because TTS needs a concrete
language; use `hi-IN` for Hindi/Hinglish or `en-IN` for English.

Canonical payload for the voice signature (newline-separated):

```text
voice-v1
<agent>
<lang>
<speaker>
<model>
```

Supported models are `bulbul:v3` and `bulbul:v4-flash`. Speaker names are
Sarvam's (for example `shubh`, `simran`, or a v4 persona such as
`shubh_enhi_ads`).

Sign a voice URL:

```bash
cd apps/sarvam-bridge
SARVAM_VOICE_BRIDGE_URL=https://<worker-host>/v1/voice \
SARVAM_BRIDGE_SIGNING_SECRET=<secret> \
bun run sign-voice-url --agent my-agent --lang hi-IN --speaker shubh --model bulbul:v3
```

Vapi assistant voice configuration:

```json
{
  "voice": {
    "provider": "custom-voice",
    "voiceId": "shubh",
    "server": {
      "url": "https://<worker-host>/v1/voice?...&sig=...",
      "secret": "<SARVAM_BRIDGE_SECRET>",
      "timeoutSeconds": 45
    },
    "fallbackPlan": {
      "voices": [{ "provider": "vapi", "voiceId": "Elliot" }]
    }
  }
}
```

Keep the fallback voice. Sarvam TTS is a synchronous REST call, so the first
token of audio arrives after the full clip is synthesized. If latency matters,
the next step would be Sarvam's streaming TTS endpoint and a chunked response.

## Environment

The Worker needs:

| Variable                       | Purpose                                          |
| ------------------------------ | ------------------------------------------------ |
| `SARVAM_API_KEY`               | Sarvam key. Never goes to Convex or the browser. |
| `SARVAM_BRIDGE_SECRET`         | Value Vapi sends in `x-vapi-secret`.             |
| `SARVAM_BRIDGE_SIGNING_SECRET` | HMAC key for signed transcriber and voice URLs.  |

They live in `packages/infra-sarvam-bridge/.env` (gitignored) and are declared
in `packages/infra-sarvam-bridge/.env.schema`.

Generate the two bridge secrets with:

```bash
openssl rand -hex 32
```

## Deploy

```bash
cd packages/infra-sarvam-bridge
bunx alchemy profile refresh --profile default --provider Cloudflare
bunx alchemy deploy
```

Or from the repo root:

```bash
bun run deploy:bridge
bun run deploy:web
```

The bridge deploy prints the `sarvamBridge` URL. Use it with `https://`
replaced by `wss://` when signing transcriber URLs.

Local emulation is `bun run dev:infra:bridge`; the bridge listens on port 3010.
The web stack is emulated separately with `bun run dev:infra:web` on port 3001.
The two stacks have independent `.env.schema` files and Alchemy state.

## Sign a transcriber URL

```bash
cd apps/sarvam-bridge

SARVAM_BRIDGE_URL=https://<worker-host>/v1/transcriber \
SARVAM_BRIDGE_SIGNING_SECRET=<secret> \
bun run sign-url --agent my-agent --lang hi-IN --mode codemix
```

The script prints a `wss://` URL. Put it in the Vapi assistant:

```json
{
  "transcriber": {
    "provider": "custom-transcriber",
    "server": {
      "url": "wss://<worker-host>/v1/transcriber?...&sig=...",
      "secret": "<SARVAM_BRIDGE_SECRET>"
    },
    "fallbackPlan": {
      "autoFallback": { "enabled": true }
    }
  }
}
```

Keep the fallback. If the bridge cannot open Sarvam (bad key, quota, network),
the object closes the Vapi socket with `1011` so Vapi can switch transcriber
instead of leaving the caller with dead air.

## Test without Vapi

Health check:

```bash
curl -s https://<worker-host>/healthz
```

End-to-end audio test (uses Sarvam TTS to generate Hindi speech, then streams
it as Vapi's stereo PCM):

```bash
cd apps/sarvam-bridge

URL=$(SARVAM_BRIDGE_URL=https://<worker-host>/v1/transcriber \
  SARVAM_BRIDGE_SIGNING_SECRET=<secret> \
  bun run sign-url --agent test-agent --lang hi-IN --mode codemix)

SARVAM_API_KEY=<key> SARVAM_BRIDGE_SECRET=<secret> \
  bun run stream-wav --url "$URL" --secret <secret> \
  --tts "नमस्ते, मेरा ऑर्डर कहाँ है?"
```

You should see Sarvam transcripts printed by the script. The same flow works
through `/voice` once the assistant's transcriber points at the bridge.

Test the voice endpoint directly:

```bash
VOICE=$(SARVAM_VOICE_BRIDGE_URL=https://<worker-host>/v1/voice \
  SARVAM_BRIDGE_SIGNING_SECRET=<secret> \
  bun run sign-voice-url --agent test-agent --lang hi-IN --speaker shubh)

curl -X POST "$VOICE" \
  -H "x-vapi-secret: <secret>" \
  -H "Content-Type: application/json" \
  -d '{"message":{"type":"voice-request","text":"नमस्ते, मैं कैसे मदद कर सकता हूँ?","sampleRate":24000}}' \
  -o /tmp/test.pcm -w '%{http_code} %{content_type} %{size_download}\n'
```

A successful response is `200 application/octet-stream` with raw 16-bit mono
PCM at 24 kHz.

## Behaviour and limits

- **Customer channel only by default.** `channels=both` opens a second Sarvam
  session for the assistant audio, doubling streaming concurrency and cost.
- **Final transcripts only.** Sarvam's standard streaming endpoint emits a
  final transcript per phrase. The bridge concatenates finals that arrive
  within 350 ms so Vapi sees one user turn per utterance. End-of-turn still
  includes Sarvam's VAD and inference latency; `high_vad_sensitivity=true` is
  enabled, so tune `maxTurnSilence` / `startSpeakingPlan` on the Vapi assistant
  if turns feel slow.
- **8 kHz calls.** The bridge passes Vapi's `sampleRate` through. Sarvam's
  connection parameter supports 8 kHz and 16 kHz; Vapi web calls use 16 kHz.
- **TTS is synchronous.** Sarvam's REST endpoint returns the whole clip before
  the Worker replies, so voice latency is higher than Sarvam's streaming TTS.
  The language and speaker are fixed in the signed voice URL, not per turn.
- **No SDK.** The bridge talks to Sarvam over a raw WebSocket for STT because
  the JS SDK silently drops `mode` and does not expose `keyterms`. TTS uses the
  REST endpoint directly.
- **No storage.** The Durable Object exists only while the socket is open.

## Next step: Convex publish integration

The backend still needs to build and sign these URLs when publishing an agent:

1. Add `SARVAM_STT_BRIDGE_URL`, `SARVAM_VOICE_BRIDGE_URL`,
   `SARVAM_BRIDGE_SECRET`, and `SARVAM_BRIDGE_SIGNING_SECRET` to the Convex
   deployment environment.
2. Reuse `protocol.ts` (or copy the canonical payloads) in
   `packages/backend/convex/lib/sarvam.ts`.
3. Map a `sarvam` transcriber/voice config to Vapi's `custom-transcriber` and
   `custom-voice` objects in `buildVapiPayload`.
4. Add the Sarvam presets to the agent builder UI.

Until then, sign URLs with the scripts and PATCH the Vapi assistant manually.
