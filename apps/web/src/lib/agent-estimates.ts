import type { AgentConfig } from "@convex-vapi/backend/convex/lib/agentConfig";

export type ComponentKey = "transcriber" | "model" | "voice";
export type SummaryComponent = ComponentKey | "hosting";

export type EstimatedComponent = {
  key: SummaryComponent;
  label: string;
  provider: string;
  name: string;
  costPerMinute: number;
  latencyMs: number;
  colorClass: string;
};

function modelCost(model: string): number {
  const normalized = model.toLowerCase();
  if (normalized.includes("mini")) {
    return 0.01;
  }
  if (normalized.includes("4o")) {
    return 0.03;
  }
  if (normalized.includes("claude") || normalized.includes("sonnet")) {
    return 0.04;
  }
  return 0.02;
}

function modelLatency(model: string): number {
  const normalized = model.toLowerCase();
  if (normalized.includes("mini")) {
    return 500;
  }
  if (normalized.includes("4o")) {
    return 600;
  }
  if (normalized.includes("claude") || normalized.includes("sonnet")) {
    return 750;
  }
  return 650;
}

export function estimateAgent(config: AgentConfig): {
  components: EstimatedComponent[];
  totalCostPerMinute: number;
  totalLatencyMs: number;
} {
  const transcriber: EstimatedComponent = {
    key: "transcriber",
    label: "Transcriber",
    provider: config.transcriber.provider,
    name: config.transcriber.model,
    costPerMinute: config.transcriber.provider.toLowerCase().includes("deepgram") ? 0.004 : 0.005,
    latencyMs: 300,
    colorClass: "bg-sky-500",
  };
  const model: EstimatedComponent = {
    key: "model",
    label: "Model",
    provider: config.model.provider,
    name: config.model.model,
    costPerMinute: modelCost(config.model.model),
    latencyMs: modelLatency(config.model.model),
    colorClass: "bg-violet-500",
  };
  const voice: EstimatedComponent = {
    key: "voice",
    label: "Voice",
    provider: config.voice.provider,
    name: config.voice.voiceId,
    costPerMinute: config.voice.provider.toLowerCase().includes("11labs") ? 0.02 : 0.02,
    latencyMs: 400,
    colorClass: "bg-emerald-500",
  };
  const hosting: EstimatedComponent = {
    key: "hosting",
    label: "Hosting",
    provider: "Vapi",
    name: "Vapi",
    costPerMinute: 0.05,
    latencyMs: 0,
    colorClass: "bg-slate-500",
  };

  const components = [hosting, transcriber, model, voice];
  return {
    components,
    totalCostPerMinute: components.reduce((sum, item) => sum + item.costPerMinute, 0),
    totalLatencyMs: components.reduce((sum, item) => sum + item.latencyMs, 0),
  };
}

export function formatCostPerMinute(value: number, precision = 2): string {
  return `~$${value.toFixed(precision)}/min`;
}

export function formatLatency(ms: number): string {
  return `~${ms.toLocaleString("en-US")} ms`;
}

export function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.trim().length / 4));
}

export type ModelPreset = {
  id: string;
  label: string;
  description: string;
  apply: (config: AgentConfig) => AgentConfig;
};

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "GPT-4o mini with Deepgram and ElevenLabs",
    apply: (config) => ({
      ...config,
      model: {
        ...config.model,
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.6,
        maxTokens: 220,
      },
    }),
  },
  {
    id: "high-intelligence",
    label: "High Intelligence",
    description: "GPT-4o with lower temperature",
    apply: (config) => ({
      ...config,
      model: {
        ...config.model,
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.4,
        maxTokens: 320,
      },
    }),
  },
  {
    id: "ultra-fast",
    label: "Ultra Fast",
    description: "Short answers with GPT-4o mini",
    apply: (config) => ({
      ...config,
      model: {
        ...config.model,
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.3,
        maxTokens: 150,
      },
    }),
  },
  {
    id: "cost-saver",
    label: "Cost Saver",
    description: "Lower token budget on GPT-4o mini",
    apply: (config) => ({
      ...config,
      model: {
        ...config.model,
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.5,
        maxTokens: 160,
      },
    }),
  },
];
