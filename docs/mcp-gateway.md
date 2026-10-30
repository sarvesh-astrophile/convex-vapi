# MCP gateway Worker

`workers/mcp-gateway` is a small, stateless Cloudflare Worker that runs MCP
tool calls on behalf of the voice runtime. It is deliberately separated from
the `VoiceSession` Durable Object so that user-supplied MCP servers, credentials,
and untrusted tool output do not run inside the call runtime or the Convex data
plane.

It has no database and no Convex credentials. Every request carries a
short-lived, encrypted **session token** that describes which MCP servers the
call may use.

## What it does

- Aggregates one or more remote MCP servers.
- Exposes their tools under namespaced names (`serverId__toolName`).
- Executes `tools/call` against the correct upstream server.
- Enforces URL, header, size, and timeout policy.
- Speaks both a simple REST API and a stateless MCP JSON-RPC subset
  (`initialize`, `tools/list`, `tools/call`, `ping`).

It does **not** store data, manage OAuth, cache tool schemas, or decide which
tools an agent should use. Those belong to Convex and the agent configuration.

## Endpoints

| Method | Path             | Auth                             | Purpose                                                        |
| ------ | ---------------- | -------------------------------- | -------------------------------------------------------------- |
| `GET`  | `/health`        | none                             | Liveness                                                       |
| `POST` | `/v1/session`    | `Bearer <GATEWAY_SHARED_SECRET>` | Validate server config, return an encrypted session token      |
| `POST` | `/v1/tools/list` | `Bearer <session token>`         | List namespaced tools from all servers                         |
| `POST` | `/v1/tools/call` | `Bearer <session token>`         | Call one tool                                                  |
| `POST` | `/mcp`           | `Bearer <session token>`         | MCP JSON-RPC: `initialize`, `tools/list`, `tools/call`, `ping` |

### `POST /v1/session`

```json
{
  "servers": [
    {
      "id": "cal",
      "url": "https://mcp.example.com/mcp",
      "headers": { "authorization": "Bearer upstream-token" },
      "allowedTools": ["list_events"]
    }
  ],
  "ttlMs": 600000
}
```

Response:

```json
{ "token": "mcp1.<iv>.<ciphertext>", "expiresAt": 1793277600000 }
```

The token is AES-256-GCM encrypted with a key derived from
`GATEWAY_SHARED_SECRET`. It contains the upstream URLs and headers, so treat it
as a secret. It is not stored anywhere.

### `POST /v1/tools/list`

```json
{ "tools": [], "errors": [] }
```

Each tool:

```json
{
  "name": "cal__list_events",
  "serverId": "cal",
  "toolName": "list_events",
  "description": "List calendar events",
  "inputSchema": { "type": "object" }
}
```

If one server is down, its tools are omitted and `errors` explains why. The
other servers still return tools.

### `POST /v1/tools/call`

```json
{ "serverId": "cal", "toolName": "list_events", "arguments": { "date": "2026-10-31" } }
```

Response is the upstream MCP result:

```json
{ "content": [{ "type": "text", "text": "10:00 standup" }] }
```

### `POST /mcp`

Standard JSON-RPC 2.0. Tool names must be namespaced when more than one server
is configured. Tool execution errors are returned as JSON-RPC errors:

```json
{ "jsonrpc": "2.0", "id": 3, "error": { "code": -32000, "message": "..." } }
```

## Security model

- **Admin vs session auth.** Only the runtime knows `GATEWAY_SHARED_SECRET` and
  can mint session tokens. Tools routes accept only session tokens.
- **Encrypted tokens.** Upstream headers (including bearer tokens) are encrypted
  at rest in the token and never logged.
- **URL policy.** Only `https://` is allowed by default. `http://` requires
  `ALLOW_INSECURE_MCP=true` (local only). URLs with credentials are rejected.
- **Private ranges blocked.** `localhost`, loopback, link-local, private IPv4,
  unique-local and link-local IPv6, `*.local`, `*.internal`, and cloud metadata
  hostnames are blocked.
- **Host allowlist.** Set `MCP_ALLOWED_HOSTS` in production. Exact hosts and
  `*.example.com` wildcards are supported. An explicit allowlist entry opts a
  host in, including internal hosts you trust.
- **Redirects refused.** A 3xx response fails the call instead of following a
  possible redirect into a private address.
- **Header policy.** Forbidden hop-by-hop headers are rejected; header count,
  name, value, and total size are capped.
- **Response cap.** Upstream response bodies are read with a byte cap and
  aborted when exceeded.
- **Timeouts.** Every upstream request has an abort timeout.
- **No secret logs.** Tokens and arguments are never logged.

`MCP_ALLOWED_HOSTS` is a host-string check, not DNS resolution. If you need
stronger SSRF protection, route gateway egress through an allowlisting proxy.

## Limits

All values are environment variables and are clamped:

| Variable             | Default | Range                 |
| -------------------- | ------- | --------------------- |
| `MAX_SERVERS`        | 8       | 1–32                  |
| `MAX_TOOLS`          | 50      | 1–200                 |
| `TOOL_TIMEOUT_MS`    | 8000    | 500–30000             |
| `MAX_RESPONSE_BYTES` | 262144  | 1024–2000000          |
| `SESSION_TTL_MS`     | 600000  | 10000–3600000         |
| `ALLOW_INSECURE_MCP` | false   | boolean               |
| `MCP_ALLOWED_HOSTS`  | empty   | comma-separated hosts |

## Local development

```bash
cp workers/mcp-gateway/.dev.vars.example workers/mcp-gateway/.dev.vars
# set GATEWAY_SHARED_SECRET (at least 32 characters)
bun run dev:gateway          # http://localhost:8789
```

`bun run dev` also starts the gateway alongside Convex, the realtime Worker, and
the web app.

### Manual smoke test

```bash
SECRET=$(sed -n 's/^GATEWAY_SHARED_SECRET=//p' workers/mcp-gateway/.dev.vars)

curl -s http://localhost:8789/health

SESSION=$(curl -s -X POST http://localhost:8789/v1/session \
  -H "authorization: Bearer $SECRET" \
  -H 'content-type: application/json' \
  -d '{"servers":[{"id":"cal","url":"https://mcp.example.com/mcp"}]}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

curl -s -X POST http://localhost:8789/v1/tools/list \
  -H "authorization: Bearer $SESSION"

curl -s -X POST http://localhost:8789/mcp \
  -H "authorization: Bearer $SESSION" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
```

## Deploy

```bash
cd workers/mcp-gateway
bunx wrangler secret put GATEWAY_SHARED_SECRET
bunx wrangler deploy
```

Set `MCP_ALLOWED_HOSTS` as a Worker variable (or `wrangler secret put` if you
prefer to keep the list private). Use the same `GATEWAY_SHARED_SECRET` in the
runtime that mints sessions.

## Design decisions and limits

- **Stateless.** Each `list`/`call` performs an MCP `initialize` first. A tool
  call is therefore two upstream round trips. The voice runtime should mint one
  session per call and reuse it; a future version can cache MCP sessions in a
  Durable Object or KV.
- **No OAuth.** The gateway accepts prepared upstream headers. OAuth redirects,
  token refresh, and encryption at rest belong in the control plane (Convex or a
  dedicated auth service). Do not put refresh tokens in the session payload.
- **No schema cache.** `tools/list` hits upstream every time. Convex should cache
  schemas for the model prompt; the gateway is the execution path.
- **No audit.** The runtime should write `toolInvocations` to Convex after each
  call.
- **No batching, sampling, roots, or server notifications** beyond
  `notifications/initialized`. Only the tools capability is implemented.
- **No server-initiated SSE stream.** The `/mcp` endpoint answers each POST with
  JSON; it does not offer a GET event stream.
- **Name mapping.** Namespaced names are safe for MCP, but OpenAI-style function
  names have stricter limits. The runtime should map `serverId__tool` to a
  model-safe name and back.
