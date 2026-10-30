import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { Env, ModelConfig } from "./env";

/**
 * Resolve the per-agent model. The model is plain provider/model config stored
 * in Convex, so changing it is a publish, not a deploy.
 */
export function resolveModel(config: ModelConfig, env: Env): LanguageModel {
  const provider = config.provider.toLowerCase();

  if (provider === "sarvam") {
    if (!env.SARVAM_API_KEY) {
      throw new Error("SARVAM_API_KEY is not configured");
    }
    const sarvam = createOpenAICompatible({
      name: "sarvam",
      baseURL: "https://api.sarvam.ai/v1",
      apiKey: env.SARVAM_API_KEY,
      headers: { "api-subscription-key": env.SARVAM_API_KEY },
      // Sarvam reasoning tokens hurt time-to-first-token on voice turns.
      transformRequestBody: (body) => ({ ...body, reasoning_effort: null }),
    });
    return sarvam(config.model);
  }

  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured for this voice runtime");
    }
    return createOpenAI({ apiKey: env.OPENAI_API_KEY })(config.model);
  }

  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured for this voice runtime");
    }
    return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(config.model);
  }

  if (provider === "cloudflare-gateway") {
    if (!env.CLOUDFLARE_AI_GATEWAY_URL) {
      throw new Error("CLOUDFLARE_AI_GATEWAY_URL is not configured");
    }
    if (!env.OPENAI_API_KEY && !env.CLOUDFLARE_AI_GATEWAY_TOKEN) {
      throw new Error(
        "Cloudflare AI Gateway needs OPENAI_API_KEY or an authenticated gateway token (CLOUDFLARE_AI_GATEWAY_TOKEN)",
      );
    }

    const baseURL = env.CLOUDFLARE_AI_GATEWAY_URL.replace(/\/$/, "");
    const headers: Record<string, string> = {};
    if (env.CLOUDFLARE_AI_GATEWAY_TOKEN) {
      headers["cf-aig-authorization"] = `Bearer ${env.CLOUDFLARE_AI_GATEWAY_TOKEN}`;
    }

    // `/compat` expects provider-prefixed model ids; `/openai` expects bare ids.
    const isCompat = baseURL.endsWith("/compat");
    const model = isCompat
      ? config.model.includes("/")
        ? config.model
        : `openai/${config.model}`
      : config.model.replace(/^openai\//, "");

    const gateway = createOpenAICompatible({
      name: "cloudflare-gateway",
      baseURL,
      // BYOK gateways reject any provider Authorization header. When no
      // provider key is configured, remove the one the SDK adds and rely on
      // `cf-aig-authorization` + the stored key.
      apiKey: env.OPENAI_API_KEY ?? "unused",
      headers,
      fetch: (input, init) => {
        if (env.OPENAI_API_KEY) {
          return fetch(input, init);
        }
        const nextHeaders = new Headers(init?.headers);
        nextHeaders.delete("authorization");
        return fetch(input, { ...init, headers: nextHeaders });
      },
    });
    return gateway(model);
  }

  throw new Error(
    `Unsupported model provider "${config.provider}". Use sarvam, openai, anthropic, or cloudflare-gateway.`,
  );
}
