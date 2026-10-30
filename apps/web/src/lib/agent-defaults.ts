import type { AgentConfig } from "@convex-vapi/backend/convex/lib/agentConfig";

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
