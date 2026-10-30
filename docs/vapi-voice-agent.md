# Vapi browser voice agent

This app starts Vapi Web SDK calls from the browser and mirrors call state into
Convex. The browser talks to Vapi directly for audio; Convex never sits in the
audio path.

The builder at `/agents` creates and versions assistants, then publishes them to
Vapi. See [voice-agent-builder.md](voice-agent-builder.md) for that flow,
workspace scoping, the rate limiter, and the copilot.

## What is in the repo

| Piece                                        | Location                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Vapi Web SDK client + live transcript        | `apps/web/src/hooks/use-vapi-call.ts`                                                  |
| Voice page (`/_auth/voice`)                  | `apps/web/src/routes/_auth/voice.tsx`                                                  |
| Call history (`/_auth/calls`)                | `apps/web/src/routes/_auth/calls.index.tsx`                                            |
| Call detail + saved transcript               | `apps/web/src/routes/_auth/calls.$callId.tsx`                                          |
| `calls`, `callTurns`, `webhookEvents` tables | `packages/backend/convex/schema.ts`                                                    |
| User-scoped call queries/mutations           | `packages/backend/convex/calls.ts`                                                     |
| Signed Vapi webhook (`POST /webhooks/vapi`)  | `packages/backend/convex/http.ts`                                                      |
| Payload parsing + merge/dedupe logic         | `packages/backend/convex/lib/vapiWebhook.ts`, `packages/backend/convex/vapiWebhook.ts` |

## Setup

### 1. Create the assistant in Vapi

In the Vapi dashboard create an assistant and note:

- the **assistant ID** (`assistant_...`),
- the **public key** (Settings -> API Keys -> Public key),
- the **private key** (only needed to update the assistant from the CLI).

The public key is safe to expose to the browser. It only authorizes starting
calls against your assistants.

### 2. Configure the web app

Put the public values in `apps/web/.env`:

```dotenv
VITE_VAPI_PUBLIC_KEY=your-public-key
VITE_VAPI_ASSISTANT_ID=assistant_...
```

Then restart `bun run dev`. The voice page shows a configuration warning until
both values are present.

### 3. Configure the Convex webhook secret

The secret is server-only. Do **not** put it in `apps/web/.env`.

```bash
cd packages/backend
bunx convex env set VAPI_WEBHOOK_SECRET "whsec_$(openssl rand -hex 24)"
```

Use the exact same string as the assistant's `server.secret` in the next step.

### 4. Point the assistant at Convex

Use the `.convex.site` domain, not `.convex.cloud`:

```bash
curl -X PATCH "https://api.vapi.ai/assistant/<assistant-id>" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "server": {
      "url": "https://<deployment>.convex.site/webhooks/vapi",
      "secret": "<the same VAPI_WEBHOOK_SECRET>"
    },
    "serverMessages": ["status-update", "end-of-call-report"]
  }'
```

You can also set `server.url` and `server.secret` in the assistant settings in
the dashboard. The route rejects requests with a missing or wrong
`X-Vapi-Secret` header.

### 5. Run it

```bash
bun run dev
```

Open <http://localhost:3001/voice>, sign in, and press **Start call**. Allow
microphone access.

## Flow

```text
Browser                 Vapi                     Convex
  │                       │                        │
  ├─ vapi.start() ───────►│                        │
  │◄── call.id ───────────┤                        │
  ├─ calls.register ──────────────────────────────►│ insert calls row
  │                       │                        │
  │◄══ WebRTC audio ══════╡                        │
  │◄── transcript/status messages (client SDK)     │
  │                       │                        │
  │                       ├─ status-update ───────►│ merge status
  │                       ├─ end-of-call-report ──►│ transcript, summary,
  │                       │                        │ turns, cost, recording
  │◄── reactive query updates (WebSocket) ─────────┤
```

- `calls.register` claims the Vapi call for the signed-in Better Auth user.
- The webhook verifies the shared secret, deduplicates by SHA-256 of the raw
  body, and never regresses an `ended` call back to an active status.
- `end-of-call-report` turns are stored in `callTurns` with a stable
  `callId:index` key, so redelivery is idempotent.
- Queries are scoped by `userId` (the Better Auth user id) and bounded with
  `take()`. There is no workspace/organization layer in this scaffold yet.

## WebSockets vs WebRTC

The browser call uses Vapi's Web SDK, which transports audio over WebRTC
(Daily). It does not open a raw WebSocket to this app. "Live" UI updates come
from Convex's WebSocket query sync, so the dashboard re-renders without polling.

If you specifically need Vapi's **WebSocket transport** (`transport.provider =
"vapi.websocket"`), that is a server-side audio path: you `POST /call` with the
private key, connect to `transport.websocketCallUrl`, and stream PCM frames
yourself. Convex actions cannot hold long-lived sockets, so that variant needs a
separate always-on host (a Cloudflare Durable Object or similar). The web demo
does not use it.

## Environment summary

| Variable                 | Where                                      | Secret? |
| ------------------------ | ------------------------------------------ | ------- |
| `VITE_VAPI_PUBLIC_KEY`   | `apps/web/.env`                            | No      |
| `VITE_VAPI_ASSISTANT_ID` | `apps/web/.env`                            | No      |
| `VAPI_WEBHOOK_SECRET`    | Convex deployment env                      | Yes     |
| `VAPI_API_KEY`           | Only for `curl`/server-side Vapi API calls | Yes     |

## Limitations

- Demo scope: one assistant from `VITE_VAPI_ASSISTANT_ID`; no assistant CRUD.
- A browser call is recorded only after the client receives the Vapi call id.
  A webhook that arrives first is reconciled by `calls.register`.
- Live transcript is client-side. Persisted turns come from the
  end-of-call report, not partial transcript webhooks.
- Ownership is a single Better Auth user. Add workspace scoping before exposing
  call history across an organization.
