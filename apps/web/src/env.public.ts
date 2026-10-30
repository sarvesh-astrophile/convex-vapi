// Alchemy validates deployment inputs with Varlock; Workers use native env bindings.
import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
  VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL!,
  VITE_CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL!,
  VITE_VOICE_RUNTIME_URL: import.meta.env.VITE_VOICE_RUNTIME_URL ?? "",
  VITE_VOICE_AGENT_ID: import.meta.env.VITE_VOICE_AGENT_ID ?? "",
} satisfies Pick<
  PublicCoercedEnvSchema,
  "VITE_CONVEX_URL" | "VITE_CONVEX_SITE_URL" | "VITE_VOICE_RUNTIME_URL" | "VITE_VOICE_AGENT_ID"
>;
