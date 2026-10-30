import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
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
      },
      dev: {
        port: 3011,
      },
    });

    return {
      voiceRuntime: voiceRuntime.url,
    };
  }),
);
