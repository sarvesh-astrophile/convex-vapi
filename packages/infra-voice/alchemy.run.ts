import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import "varlock/auto-load";

/**
 * Cloudflare Agents voice runtime. One Durable Object per call, with Sarvam
 * STT/TTS adapters and a per-agent LLM.
 */
export default Alchemy.Stack(
  "convex-vapi-voice-runtime",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const voiceRuntime = yield* Cloudflare.Worker("voice-runtime", {
      main: "../../apps/voice-runtime/src/worker.ts",
      compatibility: {
        flags: ["global_fetch_strictly_public"],
      },
      env: {
        SarvamVoiceAgent: Cloudflare.DurableObject("SarvamVoiceAgent"),
        SARVAM_API_KEY: Config.Redacted("SARVAM_API_KEY"),
        VOICE_SYNC_SECRET: Config.Redacted("VOICE_SYNC_SECRET"),
        CONVEX_SITE_URL: Config.String("CONVEX_SITE_URL"),
        OPENAI_API_KEY: Config.Redacted("OPENAI_API_KEY").pipe(
          Config.withDefault(Redacted.make("")),
        ),
        CLOUDFLARE_AI_GATEWAY_URL: Config.String("CLOUDFLARE_AI_GATEWAY_URL").pipe(
          Config.withDefault(""),
        ),
        CLOUDFLARE_AI_GATEWAY_TOKEN: Config.Redacted("CLOUDFLARE_AI_GATEWAY_TOKEN").pipe(
          Config.withDefault(Redacted.make("")),
        ),
      },
      dev: {
        port: 3011,
        // Silently drifting to 3012 leaves VITE_VOICE_RUNTIME_URL pointing at
        // a dead port, so fail loudly instead.
        strictPort: true,
      },
    });

    return {
      voiceRuntime: voiceRuntime.url,
    };
  }),
);
