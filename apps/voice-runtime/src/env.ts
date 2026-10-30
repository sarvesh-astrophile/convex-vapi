export interface Env {
  SarvamVoiceAgent: DurableObjectNamespace;
  SARVAM_API_KEY: string;
  VOICE_SYNC_SECRET: string;
  CONVEX_SITE_URL: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  CLOUDFLARE_AI_GATEWAY_URL?: string;
}

export type Runtime = "vapi" | "cloudflare";

export type ModelConfig = {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

export type AgentConfig = {
  firstMessage: string;
  firstMessageMode?: string;
  systemPrompt: string;
  model: ModelConfig;
  voice: {
    provider: string;
    voiceId: string;
    model?: string;
  };
  transcriber: {
    provider: string;
    model: string;
    language: string;
    mode?: string;
    keyterms?: string[];
  };
};

export type LoadedAgentConfig = {
  agentId: string;
  workspaceId: string;
  name: string;
  versionId: string;
  runtime: Runtime;
  config: AgentConfig;
};
