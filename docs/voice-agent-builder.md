# Voice agent builder

The builder at `/agents` is a workspace-scoped editor for versioned voice
agents. Agents run on the Cloudflare voice runtime with Sarvam STT/TTS and a
selectable LLM.

## Flow

```text
/agents/new ──► draft + version 1
      │
      ├─ Save draft ──► new immutable version
      │
      ├─ Publish ─────► mark version live
      │
      └─ Test call ───► /voice?agent=<id>
```

Publishing does not call an external provider. It marks the current version as
`publishedVersionId` and sets the agent runtime to `cloudflare`.

## Configuration

`agentVersions.config` is the complete voice-agent config:

```ts
{
  firstMessage: string;
  firstMessageMode?: "assistant-speaks-first" | "assistant-waits-for-user" | ...;
  systemPrompt: string;
  model: {
    provider: "sarvam" | "openai" | "anthropic" | "cloudflare-gateway";
    model: string;
    temperature: number;
    maxTokens: number;
  };
  voice: {
    provider: "sarvam";
    voiceId: string;       // speaker, e.g. "shubh"
    model?: string;        // "bulbul:v3" | "bulbul:v4-flash"
  };
  transcriber: {
    provider: "sarvam";
    model: "saaras:v4";
    language: string;      // "unknown" auto-detects
    mode?: "transcribe" | "codemix" | "translit" | "translate" | "verbatim";
    keyterms?: string[];
  };
}
```

The **Use Sarvam stack** button fills this in with Sarvam-105B, Saaras v4, and
Bulbul v3.

## Runtime

At call start, the Durable Object fetches the published version from Convex:

```text
GET /voice/config?agentId=<id>
x-voice-secret: <VOICE_SYNC_SECRET>
```

The response contains the workspace, version, runtime, and config. The config is
kept in memory for that call.

When the call ends:

```text
POST /webhooks/voice
x-voice-secret: <VOICE_SYNC_SECRET>
```

Convex upserts the call, stores turns, and records runtime/model metadata. The
handler is idempotent by `callId` and turn key.

## Builder UI

- summary metrics for cost/latency
- component cards for transcriber, model, voice
- prompt editor and first-message controls
- Sarvam preset
- copilot (`copilot.chat`, `copilot.generateConfig`)
- publish/test/archive actions

Cost and latency values are local heuristics, not billing data.

## Copilot

The copilot still uses the Convex AI Gateway and stores threads in
`copilotThreads`. It can generate a full config, including Sarvam providers.

## Related

- [Cloudflare voice runtime](cloudflare-voice-runtime.md)
- [Sarvam streaming STT](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/streaming-api)
- [Cloudflare Voice](https://developers.cloudflare.com/agents/agent-class/communication-channels/voice/)
