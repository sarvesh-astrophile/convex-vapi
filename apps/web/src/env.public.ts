// Alchemy validates deployment inputs with Varlock; Workers use native env bindings.
import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
  VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL!,
  VITE_CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL!,
  VITE_VOICE_RUNTIME_URL: import.meta.env.VITE_VOICE_RUNTIME_URL ?? "",
  VITE_VOICE_AGENT_ID: import.meta.env.VITE_VOICE_AGENT_ID ?? "",
  VITE_VAPI_ASSISTANT_ID: import.meta.env.VITE_VAPI_ASSISTANT_ID ?? "",
  VITE_VAPI_PHONE_NUMBER_ID: import.meta.env.VITE_VAPI_PHONE_NUMBER_ID ?? "",
  VITE_VAPI_PUBLIC_KEY: import.meta.env.VITE_VAPI_PUBLIC_KEY ?? "",
  VITE_VAPI_PAYTM_ASSISTANT_ID: import.meta.env.VITE_VAPI_PAYTM_ASSISTANT_ID ?? "",
} satisfies Pick<
  PublicCoercedEnvSchema,
  | "VITE_CONVEX_URL"
  | "VITE_CONVEX_SITE_URL"
  | "VITE_VOICE_RUNTIME_URL"
  | "VITE_VOICE_AGENT_ID"
  | "VITE_VAPI_ASSISTANT_ID"
  | "VITE_VAPI_PHONE_NUMBER_ID"
  | "VITE_VAPI_PUBLIC_KEY"
  | "VITE_VAPI_PAYTM_ASSISTANT_ID"
>;
