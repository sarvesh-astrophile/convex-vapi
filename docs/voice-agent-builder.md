# Voice agent builder

This app now has a Vapi-like builder inside Convex:

- workspace-scoped agents
- immutable configuration versions
- publish to Vapi via the REST API
- browser test calls
- call history linked back to the agent
- per-user rate limits
- an in-app builder copilot backed by the Convex Agent component

Vapi remains the voice runtime. Convex owns drafts, versions, ownership, and
call records.

## Architecture

```text
Builder UI
    │
    ├─ agents.create / agents.save ──► Convex agentVersions
    │
    ├─ agents.publish (action)
    │     ├─ rate limiter
    │     ├─ POST/PATCH https://api.vapi.ai/assistant
    │     └─ markPublished
    │
    ├─ /voice?assistant=<vapi-id> ──► Vapi Web SDK (WebRTC)
    │
    └─ Vapi webhook ──► calls + callTurns + webhookEvents
```

Why not rebuild Vapi's pipeline: STT, LLM, TTS, telephony, interruption
handling, and WebRTC transport are the hard realtime parts. The builder should
configure and orchestrate Vapi, not replace it.

Why not a reusable Vapi component yet: the builder's agents, versions, tools,
and workspace ownership are product data. They need joins, workspace checks, and
fast list queries. A Convex component is an isolation/reuse boundary, not a
feature boundary. The Vapi client currently lives in `convex/vapi/client.ts`.
Extract a local component later if the call-sync layer is reused elsewhere.

## Backend files

| File                          | Purpose                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `convex/schema.ts`            | workspaces, members, agents, versions, calls, copilot threads |
| `convex/lib/workspaceAuth.ts` | `requireWorkspaceMember` / `requireRole`                      |
| `convex/workspaces.ts`        | personal workspace creation, active workspace, members        |
| `convex/agents.ts`            | create/save/list/get/archive and publish action               |
| `convex/vapi/client.ts`       | typed Vapi assistant REST client                              |
| `convex/rateLimits.ts`        | publish, Vapi, copilot, test-call limits                      |
| `convex/copilot.ts`           | Convex Agent thread + builder copilot action                  |
| `convex/vapiWebhook.ts`       | call webhook merge and agent linking                          |

## Builder UI

The editor at `/agents/$agentId` follows the Vapi assistant-settings layout:

- summary estimate row for cost/minute and latency, with segmented bars
- model presets (`Balanced`, `High Intelligence`, `Ultra Fast`, `Cost Saver`)
- three clickable component cards for transcriber, model, and voice
- large system-prompt editor with token count and a copilot **Generate** action
- first-message mode and message controls
- files placeholder (not wired to Vapi yet)
- a **Generate config** action that fills name, description, prompt, first
  message, model, voice, and transcriber from a plain-English brief
- sticky save/publish/test/archive action bar

The cost and latency numbers are local heuristics based on the selected
providers/models, not Vapi billing or measured latency. They are meant to guide
configuration choices.

## Versioning model

- `agents.currentVersionId` points at the latest draft.
- `agents.publishedVersionId` points at the version currently pushed to Vapi.
- Every `agents.save` inserts a new immutable `agentVersions` row.
- `agents.publish` sends the current version to Vapi:
  - `POST /assistant` if the agent has no `vapiAssistantId`
  - `PATCH /assistant/:id` if it already has one
- The returned Vapi assistant ID is stored on the agent and version.

The UI shows **Unpublished changes** when the current version differs from the
published version.

## Workspaces

Every signed-in user gets a personal workspace on first visit to `/agents` or
`/voice`. `workspaceMembers` supports `owner`, `admin`, and `member` roles. Agent
queries and mutations verify membership server-side; a client-supplied
`workspaceId` is never trusted on its own.

There is no invite UI yet. `workspaces.listMine`, `setActive`, `rename`, and
`listMembers` are ready for a members screen.

The current Better Auth install uses the packaged component, which does not
include the organization plugin tables. Workspaces therefore live in app tables
(`workspaces`, `workspaceMembers`, `userWorkspaceState`). If you later switch to
a local Better Auth install with the organization plugin, migrate these rows to
`organization` / `member` and keep the same `workspaceId` shape on agents and
calls.

## Convex components used

### Rate limiter

Mounted in `convex/convex.config.ts`. Limits live in `convex/rateLimits.ts`:

- `publishAgent` — publish bursts per workspace/agent
- `vapiWrite` — budget for future Vapi writes
- `copilot` — copilot messages per user
- `testCall` — future test-call gating

### Agent component

Used for the **builder copilot**, not for the voice loop. Each user/workspace
gets one copilot thread stored in `copilotThreads`. The copilot calls
`convexGateway("openai/gpt-4o-mini")` from `@convex-dev/ai-sdk-provider` and
receives the current draft as context.

Two actions are exposed:

- `copilot.chat` — free-form prompt/tool/model advice, stored in the thread.
- `copilot.generateConfig` — structured output that fills the entire agent form
  from a brief (name, description, first message, system prompt, model, voice,
  transcriber).

The voice conversation itself still runs inside Vapi.

## Setup

### Convex environment

```bash
cd packages/backend
bunx convex env set VAPI_API_KEY "your-vapi-private-key"
bunx convex env set VAPI_WEBHOOK_SECRET "whsec_..."
```

The copilot uses the **Convex AI Gateway**, so there is no `OPENAI_API_KEY` to
set. The gateway requires a paid Convex plan and `convex` 1.46+. Calls
authenticate with a short-lived deployment-scoped token minted by
`getServiceToken("ai-gateway")`.

If the team cannot use the gateway, the copilot returns a clear
`AiGatewayDisabled` / `AiGatewayUnavailable` message instead of crashing.

`VAPI_WEBHOOK_SECRET` must match the assistant's `server.secret`. Published
agents automatically get `server.url = https://<deployment>.convex.site/webhooks/vapi`
and `serverMessages = ["status-update", "end-of-call-report"]`.

`CONVEX_SITE_URL` is provided by the Convex platform and used to build the
webhook URL.

### Web environment

```dotenv
VITE_VAPI_PUBLIC_KEY=...
VITE_VAPI_ASSISTANT_ID=...
```

`VITE_VAPI_ASSISTANT_ID` is the default assistant for `/voice`. Builder test
links pass `?assistant=<vapi-id>` instead.

### Provider IDs

The default draft uses:

- model: `openai` / `gpt-4o-mini`
- voice: `11labs` / `burt`
- transcriber: `deepgram` / `nova-3` / `en`

These must be valid for your Vapi account. Edit them in the builder before
publishing.

## Try it

```bash
bun run dev
```

1. Open `http://localhost:3001/agents`.
2. Create an agent.
3. Edit the prompt, model, voice, and transcriber.
4. Save a draft.
5. Publish to Vapi.
6. Click **Test call** and allow microphone access.
7. Hang up and open `/calls` to see the linked call, transcript, and summary.

## Next phases

- Tools/functions CRUD and attach `toolIds` to published assistants.
- Phone numbers and squads.
- Workspace invites and a members page.
- Background publish/sync with `@convex-dev/workpool`.
- Call count metrics with `@convex-dev/aggregate`.
- Knowledge base / RAG.
