import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

/**
 * Independent stack for the Sarvam STT bridge. It shares no resources or state
 * with the web stack, so it can be deployed, rolled back, or destroyed alone.
 */
export default Alchemy.Stack(
  "convex-vapi-sarvam-bridge",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // One Durable Object per call keeps the inbound Vapi socket and the
    // outbound Sarvam sockets together in the same isolate.
    const sarvamBridge = yield* Cloudflare.Worker("sarvam-bridge", {
      main: "../../apps/sarvam-bridge/src/worker.ts",
      compatibility: {
        flags: ["global_fetch_strictly_public"],
      },
      observability: {
        enabled: true,
      },
      env: {
        SARVAM_SESSION: Cloudflare.DurableObject("SarvamSession"),
        SARVAM_API_KEY: Config.Redacted("SARVAM_API_KEY"),
        SARVAM_BRIDGE_SECRET: Config.Redacted("SARVAM_BRIDGE_SECRET"),
        SARVAM_BRIDGE_SIGNING_SECRET: Config.Redacted("SARVAM_BRIDGE_SIGNING_SECRET"),
      },
      dev: {
        port: 3010,
      },
    });

    return {
      sarvamBridge: sarvamBridge.url,
    };
  }),
);
