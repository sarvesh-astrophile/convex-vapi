import type { AgentConfig } from "@convex-vapi/backend/convex/lib/agentConfig";

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
