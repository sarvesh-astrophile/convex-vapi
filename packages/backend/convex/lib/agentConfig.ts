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
    model: v.optional(v.string()),
    language: v.optional(v.string()),
  }),
  transcriber: v.object({
    provider: v.string(),
    model: v.string(),
    language: v.string(),
    mode: v.optional(v.string()),
    keyterms: v.optional(v.array(v.string())),
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
    model?: string;
    language?: string;
  };
  transcriber: {
    provider: string;
    model: string;
    language: string;
    mode?: string;
    keyterms?: string[];
  };
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  firstMessage: "नमस्ते! मैं आपकी कैसे मदद कर सकता हूँ?",
  firstMessageMode: "assistant-speaks-first",
  systemPrompt:
    "You are a warm, concise voice assistant. Reply in the caller's language and keep answers short because they are spoken aloud.",
  model: {
    provider: "sarvam",
    model: "sarvam-105b",
    temperature: 0.4,
    maxTokens: 220,
  },
  voice: {
    provider: "sarvam",
    voiceId: "shubh",
    model: "bulbul:v3",
  },
  transcriber: {
    provider: "sarvam",
    model: "saaras:v4",
    language: "unknown",
    mode: "codemix",
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
    model: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
  }),
  transcriber: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    language: z.string().min(1),
    mode: z.string().min(1).optional(),
    keyterms: z.array(z.string()).max(50).optional(),
  }),
});

export type GeneratedAgentConfig = z.infer<typeof generatedAgentConfigSchema>;
