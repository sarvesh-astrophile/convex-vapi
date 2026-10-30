// Alchemy validates deployment inputs with Varlock; Workers use native env bindings.
import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
  VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL!,
  VITE_CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL!,
  VITE_VAPI_PUBLIC_KEY: import.meta.env.VITE_VAPI_PUBLIC_KEY ?? "",
  VITE_VAPI_ASSISTANT_ID: import.meta.env.VITE_VAPI_ASSISTANT_ID ?? "",
} satisfies Pick<
  PublicCoercedEnvSchema,
  "VITE_CONVEX_URL" | "VITE_CONVEX_SITE_URL" | "VITE_VAPI_PUBLIC_KEY" | "VITE_VAPI_ASSISTANT_ID"
>;
