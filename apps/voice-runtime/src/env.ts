export interface Env {
  SarvamVoiceAgent: DurableObjectNamespace;
  SARVAM_API_KEY: string;
  VOICE_SYNC_SECRET: string;
  CONVEX_SITE_URL: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  CLOUDFLARE_AI_GATEWAY_URL?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
}

export type Runtime = "vapi" | "cloudflare";

export type ModelConfig = {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

/** A tool exposed to the model. Executed as an HTTP POST by the runtime. */
export type ToolConfig = {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters?: unknown;
  endpoint: string;
  secret?: string;
};

export type TurnTakingConfig = {
  endpointingMs?: number;
  highVadSensitivity?: boolean;
  interruptThreshold?: number;
  interruptChunks?: number;
};

export type AgentConfig = {
  firstMessage: string;
  firstMessageMode?: string;
  systemPrompt: string;
  tools?: ToolConfig[];
  turnTaking?: TurnTakingConfig;
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

/** Cumulative usage for one call, flushed to Convex with the event stream. */
export type CallUsage = {
  turns: number;
  sttAudioMs: number;
  ttsCharacters: number;
  promptTokens: number;
  completionTokens: number;
  llmMs: number;
  ttsMs: number;
  firstAudioMs: number;
};
