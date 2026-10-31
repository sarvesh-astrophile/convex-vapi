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

/**
 * A tool the voice agent can call mid-turn. Tools are plain HTTP endpoints,
 * the same contract Vapi uses for `serverUrl` tools, so a workspace can point
 * an agent at any service without redeploying the runtime.
 */
export const agentToolValidator = v.object({
  name: v.string(),
  description: v.string(),
  /** JSON Schema for the arguments. */
  parameters: v.optional(v.any()),
  endpoint: v.string(),
  /** Sent as `Authorization: Bearer <secret>`. */
  secret: v.optional(v.string()),
});

export type AgentTool = {
  name: string;
  description: string;
  parameters?: unknown;
  endpoint: string;
  secret?: string;
};

/** Per-agent endpointing and interruption tuning. */
export const turnTakingValidator = v.object({
  /** Silence before Sarvam closes a turn. */
  endpointingMs: v.optional(v.number()),
  /** Split utterances sooner on noisy lines at the cost of fragments. */
  highVadSensitivity: v.optional(v.boolean()),
  /** Client-side RMS above which playback is interrupted. */
  interruptThreshold: v.optional(v.number()),
  /** Consecutive high-RMS chunks required to interrupt. */
  interruptChunks: v.optional(v.number()),
});

export type TurnTakingConfig = {
  endpointingMs?: number;
  highVadSensitivity?: boolean;
  interruptThreshold?: number;
  interruptChunks?: number;
};

export const agentConfigValidator = v.object({
  firstMessage: v.string(),
  firstMessageMode: v.optional(firstMessageModeValidator),
  systemPrompt: v.string(),
  tools: v.optional(v.array(agentToolValidator)),
  turnTaking: v.optional(turnTakingValidator),
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
  tools?: AgentTool[];
  turnTaking?: TurnTakingConfig;
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
  tools: [],
  turnTaking: {
    endpointingMs: 500,
    highVadSensitivity: false,
  },
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
  tools: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        description: z.string().min(1).max(500),
        parameters: z.record(z.string(), z.unknown()).optional(),
        endpoint: z.string().url(),
        secret: z.string().max(500).optional(),
      }),
    )
    .max(10)
    .optional(),
  turnTaking: z
    .object({
      endpointingMs: z.number().int().min(100).max(3_000).optional(),
      highVadSensitivity: z.boolean().optional(),
      interruptThreshold: z.number().min(0).max(1).optional(),
      interruptChunks: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
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
