import { v } from "convex/values";
import { z } from "zod";

/**
 * A curated subset of the Vapi `CreateAssistantDTO`. Assistant definitions live
 * in Vapi; this is what the builder edits and sends on publish.
 *
 * @see https://docs.vapi.ai/api-reference/assistants/create
 */

export const vapiFirstMessageModeValidator = v.union(
  v.literal("assistant-speaks-first"),
  v.literal("assistant-waits-for-user"),
  v.literal("assistant-speaks-first-with-model-generated-message"),
);

export type VapiFirstMessageMode =
  | "assistant-speaks-first"
  | "assistant-waits-for-user"
  | "assistant-speaks-first-with-model-generated-message";

export const vapiAssistantConfigValidator = v.object({
  /** Spoken when the call connects. */
  firstMessage: v.string(),
  firstMessageMode: vapiFirstMessageModeValidator,
  /** Becomes `model.messages[0]` with role `system` on publish. */
  systemPrompt: v.string(),
  model: v.object({
    /** Vapi provider id, e.g. `openai`, `anthropic`, `google`. */
    provider: v.string(),
    /** Provider model id, e.g. `gpt-4o-mini`. */
    model: v.string(),
    temperature: v.number(),
    maxTokens: v.number(),
  }),
  voice: v.object({
    /** Vapi voice provider id, e.g. `vapi`, `11labs`, `azure`. */
    provider: v.string(),
    /** Provider-specific voice id, e.g. `Elliot`. */
    voiceId: v.string(),
  }),
  transcriber: v.object({
    /** Vapi transcriber provider id, e.g. `deepgram`, `assembly-ai`. */
    provider: v.string(),
    model: v.string(),
    /** BCP-47 language tag, or `multi` for multilingual recognition. */
    language: v.string(),
  }),
  /** Spoken before Vapi hangs up after the end-call tool. */
  endCallMessage: v.optional(v.string()),
  /** Vapi range is 10–43200 seconds. */
  maxDurationSeconds: v.optional(v.number()),
  /** How long Vapi waits for speech before hanging up. */
  silenceTimeoutSeconds: v.optional(v.number()),
});

export type VapiAssistantConfig = {
  firstMessage: string;
  firstMessageMode: VapiFirstMessageMode;
  systemPrompt: string;
  model: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  voice: {
    provider: string;
    voiceId: string;
  };
  transcriber: {
    provider: string;
    model: string;
    language: string;
  };
  endCallMessage?: string;
  maxDurationSeconds?: number;
  silenceTimeoutSeconds?: number;
};

export const DEFAULT_VAPI_ASSISTANT_CONFIG: VapiAssistantConfig = {
  firstMessage: "Hi! Thanks for calling. How can I help you today?",
  firstMessageMode: "assistant-speaks-first",
  systemPrompt:
    "You are a warm, concise phone assistant. Answer in the caller's language, keep responses short because they are spoken aloud, and ask one question at a time. If you cannot help, offer to transfer the caller to a human. End the call politely when the caller is done.",
  model: {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.4,
    maxTokens: 250,
  },
  voice: {
    provider: "vapi",
    voiceId: "Elliot",
  },
  transcriber: {
    provider: "deepgram",
    model: "nova-3",
    language: "en",
  },
  endCallMessage: "Thanks for calling. Goodbye!",
  maxDurationSeconds: 600,
  silenceTimeoutSeconds: 30,
};

/**
 * Tool input for the builder copilot: the complete assistant draft. Echoing
 * the whole draft keeps each tool call deterministic and avoids partial
 * patches when the user iterates over several turns.
 */
export const vapiDraftUpdateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .describe("Short Vapi assistant name. Vapi limits this to 40 characters."),
  description: z
    .string()
    .max(300)
    .describe("One or two sentences describing what the assistant does."),
  config: z.object({
    firstMessage: z
      .string()
      .min(1)
      .max(1_000)
      .describe("The first thing the assistant says when the call connects."),
    firstMessageMode: z.enum([
      "assistant-speaks-first",
      "assistant-waits-for-user",
      "assistant-speaks-first-with-model-generated-message",
    ]),
    systemPrompt: z
      .string()
      .min(1)
      .max(12_000)
      .describe("System prompt for the Vapi model. Written for spoken delivery."),
    model: z.object({
      provider: z
        .string()
        .min(1)
        .describe("Vapi model provider, e.g. openai, anthropic, google, groq."),
      model: z.string().min(1).describe("Provider model id, e.g. gpt-4o-mini."),
      temperature: z.number().min(0).max(2),
      maxTokens: z.number().int().min(32).max(4_096),
    }),
    voice: z.object({
      provider: z.string().min(1).describe("Vapi voice provider, e.g. vapi, 11labs, azure."),
      voiceId: z.string().min(1).describe("Provider-specific voice id, e.g. Elliot."),
    }),
    transcriber: z.object({
      provider: z.string().min(1).describe("Vapi transcriber provider, e.g. deepgram."),
      model: z.string().min(1),
      language: z.string().min(1).describe("Language tag such as en, hi, multi."),
    }),
    endCallMessage: z
      .string()
      .max(1_000)
      .optional()
      .describe("Spoken before hanging up. Keep it short."),
    maxDurationSeconds: z.number().int().min(10).max(43_200).optional(),
    silenceTimeoutSeconds: z.number().int().min(5).max(120).optional(),
  }),
});

export type VapiDraftUpdate = z.infer<typeof vapiDraftUpdateSchema>;

/** Trim, bound, and reject an unusable draft before it reaches Vapi. */
export function normalizeVapiAssistantConfig(config: VapiAssistantConfig): VapiAssistantConfig {
  const firstMessage = config.firstMessage.trim();
  const systemPrompt = config.systemPrompt.trim();
  const model = {
    provider: config.model.provider.trim(),
    model: config.model.model.trim(),
    temperature: Math.min(Math.max(config.model.temperature, 0), 2),
    maxTokens: Math.min(Math.max(Math.round(config.model.maxTokens), 32), 4_096),
  };
  const voice = {
    provider: config.voice.provider.trim(),
    voiceId: config.voice.voiceId.trim(),
  };
  const transcriber = {
    provider: config.transcriber.provider.trim(),
    model: config.transcriber.model.trim(),
    language: config.transcriber.language.trim(),
  };

  if (
    firstMessage.length === 0 ||
    systemPrompt.length === 0 ||
    model.provider.length === 0 ||
    model.model.length === 0 ||
    voice.provider.length === 0 ||
    voice.voiceId.length === 0 ||
    transcriber.provider.length === 0 ||
    transcriber.model.length === 0 ||
    transcriber.language.length === 0
  ) {
    throw new Error("First message, system prompt, model, voice, and transcriber are required");
  }

  return {
    firstMessage: firstMessage.slice(0, 1_000),
    firstMessageMode: config.firstMessageMode,
    systemPrompt: systemPrompt.slice(0, 12_000),
    model,
    voice,
    transcriber,
    ...(config.endCallMessage?.trim()
      ? { endCallMessage: config.endCallMessage.trim().slice(0, 1_000) }
      : {}),
    ...(config.maxDurationSeconds !== undefined
      ? {
          maxDurationSeconds: Math.min(Math.max(Math.round(config.maxDurationSeconds), 10), 43_200),
        }
      : {}),
    ...(config.silenceTimeoutSeconds !== undefined
      ? {
          silenceTimeoutSeconds: Math.min(
            Math.max(Math.round(config.silenceTimeoutSeconds), 5),
            120,
          ),
        }
      : {}),
  };
}

/** Vapi caps assistant names at 40 characters. */
export function normalizeVapiAssistantName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Assistant name is required");
  }
  return trimmed.slice(0, 40);
}
