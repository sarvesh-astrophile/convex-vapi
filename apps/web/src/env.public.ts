// Alchemy validates deployment inputs with Varlock; Workers use native env bindings.
import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
  VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL!,
  VITE_CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL!,
} satisfies Pick<PublicCoercedEnvSchema, "VITE_CONVEX_URL" | "VITE_CONVEX_SITE_URL">;
