import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

/**
 * Web app stack. Kept as `convex-vapi` so deployments continue to use the
 * existing stack state.
 */
export default Alchemy.Stack(
  "convex-vapi",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const webWorker = yield* Cloudflare.Website.Vite("web", {
      rootDir: "../../apps/web",
      compatibility: {
        flags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
      env: {
        VITE_CONVEX_URL: Config.String("VITE_CONVEX_URL"),
        VITE_CONVEX_SITE_URL: Config.String("VITE_CONVEX_SITE_URL"),
        VITE_VAPI_PUBLIC_KEY: Config.String("VITE_VAPI_PUBLIC_KEY"),
        VITE_VAPI_ASSISTANT_ID: Config.String("VITE_VAPI_ASSISTANT_ID"),
      },
      dev: {
        port: 3001,
      },
    });

    return {
      web: webWorker.url,
    };
  }),
);
