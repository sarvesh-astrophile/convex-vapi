import { v } from "convex/values";
import { z } from "zod";

export const firstMessageModeValidator = v.union(
  v.literal("assistant-speaks-first"),
  v.literal("assistant-waits-for-user"),
  v.literal("assistant-speaks-first-with-model-generated-message"),
);

export type FirstMessageMode =
  | "assistant-speaks-first"
  | "assistant-waits-for-user"
  | "assistant-speaks-first-with-model-generated-message";

export const agentConfigValidator = v.object({
  firstMessage: v.string(),
  firstMessageMode: v.optional(firstMessageModeValidator),
  systemPrompt: v.string(),
  model: v.object({
    provider: v.string(),
    model: v.string(),
    temperature: v.number(),
    maxTokens: v.number(),
  }),
  voice: v.object({
    provider: v.string(),
    voiceId: v.string(),
  }),
  transcriber: v.object({
    provider: v.string(),
    model: v.string(),
    language: v.string(),
  }),
});

export type AgentConfig = {
  firstMessage: string;
  firstMessageMode?: FirstMessageMode;
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
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  firstMessage: "Hi, how can I help you today?",
  firstMessageMode: "assistant-speaks-first",
  systemPrompt:
    "You are a helpful voice assistant. Keep answers short and natural for a spoken conversation.",
  model: {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.6,
    maxTokens: 220,
  },
  voice: {
    provider: "11labs",
    voiceId: "burt",
  },
  transcriber: {
    provider: "deepgram",
    model: "nova-3",
    language: "en",
  },
};

/**
 * Structured output schema for the builder copilot. It mirrors AgentConfig and
 * is used with Convex AI Gateway `generateObject`.
 */
export const generatedAgentConfigSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  firstMessage: z.string().max(1_000),
  firstMessageMode: z.enum([
    "assistant-speaks-first",
    "assistant-waits-for-user",
    "assistant-speaks-first-with-model-generated-message",
  ]),
  systemPrompt: z.string().max(12_000),
  model: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(32).max(4_096),
  }),
  voice: z.object({
    provider: z.string().min(1),
    voiceId: z.string().min(1),
  }),
  transcriber: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    language: z.string().min(1),
  }),
});

export type GeneratedAgentConfig = z.infer<typeof generatedAgentConfigSchema>;
