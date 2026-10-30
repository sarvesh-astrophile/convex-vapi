# Operations

## Environments

Use separate Convex deployments and Cloudflare Workers for dev, staging and
production. The realtime Worker and Convex deployment must share the same
`RUNTIME_SHARED_SECRET`.

| Component      | Dev                         | Staging/Prod           |
| -------------- | --------------------------- | ---------------------- |
| Web            | `vite dev` / `wrangler dev` | `voice-agent-web`      |
| Realtime       | `wrangler dev` (8787)       | `voice-agent-realtime` |
| Convex         | dev deployment              | separate deployment    |
| Provider keys  | `.dev.vars`                 | `wrangler secret put`  |
| Browser config | `.env.local`                | build-time `VITE_*`    |

## Secret inventory

Convex deployment:

- `SITE_URL` — browser origin (auth redirects)
- `JWT_PRIVATE_KEY`, `JWKS` — Convex Auth signing keys
- `RUNTIME_SHARED_SECRET` — HMAC shared secret

Realtime Worker:

- `DEEPGRAM_API_KEY`
- `OPENROUTER_API_KEY`
- `SARVAM_API_KEY`
- `RUNTIME_SHARED_SECRET`
- `CONVEX_HTTP_URL` — `https://<deployment>.convex.site`
- `ALLOWED_ORIGINS` — comma-separated exact origins

Web build:

- `VITE_CONVEX_URL` — public
- `VITE_VOICE_WS_URL` — public, ends in `/v1/calls`

Generate the shared secret with `openssl rand -hex 32`. Rotate provider keys and
the shared secret together with deployment. Never commit `.dev.vars`, `.env`,
or real values.

## Deploy order

1. `bunx convex deploy`
2. Set Convex env vars (including the shared secret).
3. `cd workers/realtime && bun run deploy` after setting Worker secrets.
4. `cd apps/web && bun run deploy` with `VITE_*` set.
5. Run `bun run smoke -- <voice-url> <convex-site-url>`.
6. Run one real browser call in staging; verify:
   - `session.ready` appears;
   - Hindi/English transcription is readable;
   - first audio arrives before the full response completes;
   - barge-in stops audio and the next turn is answered;
   - the call record and transcript appear in Convex;
   - no keys appear in the browser network/console.

## Local commands

```bash
bun install
bun run dev                # Convex + realtime + web
bun run typecheck
bun run test
bun run lint
bun run build:web
bun run build:voice
```

`bun run dev` uses `bun run --parallel`; each service can also run separately.

## Observability

The Durable Object emits one structured JSON log line per lifecycle event:
`session_authenticated`, `session_ready`, `interrupted`, `session_failed`,
`session_closed`, `event_delivery_failed`, `outbox_recovered`. Logs include the
call ID, state, generation ID and safe error codes. They do **not** include
prompts, transcripts, tickets or provider keys.

Useful Cloudflare queries:

- `wrangler tail voice-agent-realtime --format pretty`
- Filter on `"scope":"voice_session"` and `"event":"session_failed"`.

Convex dashboard logs show HTTP action status codes and function errors. The
scheduled reconciler logs are visible in the Convex functions log.

## Failure runbook

| Symptom                        | Check                                            | Action                                                |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------------- |
| `ticket_invalid`               | Ticket TTL (60 s), call status, secret match     | Restart call; verify clocks                           |
| `unauthorized` on `/runtime/*` | `RUNTIME_SHARED_SECRET` equality, timestamp skew | Re-set both secrets together                          |
| `session_fetch_failed`         | Convex HTTP URL, Convex logs                     | Fix URL; redeploy                                     |
| `stt_disconnected`             | Deepgram status/key, model/language              | Verify key and account access                         |
| `provider_auth_failed`         | Revoked/rotated keys                             | Rotate and redeploy Worker                            |
| `llm_timeout`                  | OpenRouter latency/rate limits                   | Retry; lower `LLM_MAX_TOKENS`                         |
| `tts_timeout`                  | Sarvam status, voice ID                          | Verify voice/language; retry                          |
| Call stuck `active`            | DO eviction / crash                              | Wait for 15 min reconciler                            |
| Call stuck `created`           | Browser never authenticated                      | Wait for 10 min reconciler                            |
| Events not persisted           | `event_delivery_failed` logs                     | Check Convex HTTP endpoint; DO retries up to 10 times |
| No audio but transcripts work  | Browser autoplay, output context, sample rate    | Reclick Talk (gesture), check console                 |
| Echo triggers barge-in         | Speaker volume, headphones                       | Test headphones; tune VAD thresholds                  |

## Rollback

- Workers: `bunx wrangler rollback` or redeploy the previous commit.
- Convex: deploy the previous commit. The schema has no destructive migrations.
- Secret rotation: deploy Convex and Worker with the new shared secret in the
  same change window. In-flight tickets/signatures fail closed; users restart
  calls.

## Cost and abuse controls

- 10-minute max call.
- 60 turns max.
- 220 output tokens per turn.
- Two recent calls per owner.
- Bounded input/output/event queues.
- No audio recording or storage.

These are application-level guards, not a substitute for provider account
budgets and Cloudflare rate limiting. Add per-IP/owner rate limits before opening
a public deployment.

## Privacy

- System prompts and transcripts live in Convex.
- Provider requests necessarily include prompt/transcript content; review each
  provider's data-retention policy before production.
- No raw audio is stored.
- Logs are scrubbed by construction: the code never logs text, audio or secrets.
