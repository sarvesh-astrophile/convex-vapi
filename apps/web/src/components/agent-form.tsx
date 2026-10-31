import { api } from "@convex-vapi/backend/convex/_generated/api";
import type { Id } from "@convex-vapi/backend/convex/_generated/dataModel";
import type { AgentConfig } from "@convex-vapi/backend/convex/lib/agentConfig";
import { Button, buttonVariants } from "@convex-vapi/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@convex-vapi/ui/components/card";
import { Input } from "@convex-vapi/ui/components/input";
import { Label } from "@convex-vapi/ui/components/label";
import { Textarea } from "@convex-vapi/ui/components/textarea";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import {
  Archive,
  Bot,
  Cpu,
  ExternalLink,
  FileText,
  Loader2,
  Mic,
  Pencil,
  Save,
  Sparkles,
  Upload,
  Volume2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  estimateAgent,
  estimateTokens,
  formatCostPerMinute,
  formatLatency,
  MODEL_PRESETS,
  type ComponentKey,
} from "@/lib/agent-estimates";
import { errorMessage } from "@/lib/errors";

type AgentFormProps = {
  workspaceId: Id<"workspaces">;
  agentId?: Id<"agents">;
  initialName?: string;
  initialDescription?: string;
  initialConfig: AgentConfig;
  status?: "draft" | "published" | "archived";
};

const FIRST_MESSAGE_MODES = [
  { value: "assistant-speaks-first", label: "Assistant speaks first" },
  { value: "assistant-waits-for-user", label: "Assistant waits for user" },
  {
    value: "assistant-speaks-first-with-model-generated-message",
    label: "Assistant generates first message",
  },
] as const;

function SegmentedBar({
  components,
  metric,
}: {
  components: ReturnType<typeof estimateAgent>["components"];
  metric: "costPerMinute" | "latencyMs";
}) {
  const total = components.reduce((sum, item) => sum + item[metric], 0);
  if (total <= 0) {
    return null;
  }

  return (
    <div className="flex h-1.5 w-full gap-0.5 overflow-hidden">
      {components.map((item) => (
        <div
          key={item.key}
          title={`${item.label}: ${metric === "costPerMinute" ? formatCostPerMinute(item.costPerMinute, 3) : formatLatency(item.latencyMs)}`}
          className={`h-full min-w-1 rounded-full ${item.colorClass}`}
          style={{ flexGrow: item[metric], flexBasis: 0 }}
        />
      ))}
    </div>
  );
}

function MetricBlock({
  label,
  value,
  components,
  metric,
}: {
  label: string;
  value: string;
  components: ReturnType<typeof estimateAgent>["components"];
  metric: "costPerMinute" | "latencyMs";
}) {
  return (
    <div className="grid gap-2">
      <span
        className="text-muted-foreground w-fit cursor-help text-xs font-medium underline decoration-dotted underline-offset-4"
        title={`${label} estimate for a typical 1-minute call`}
      >
        {label}
      </span>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <span className="font-mono text-xl font-semibold leading-none">{value}</span>
        <SegmentedBar components={components} metric={metric} />
      </div>
    </div>
  );
}

function AssistantCard({
  icon,
  label,
  name,
  provider,
  cost,
  latency,
  active,
  onEdit,
}: {
  icon: ReactNode;
  label: string;
  name: string;
  provider: string;
  cost: string;
  latency: string;
  active: boolean;
  onEdit: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit();
        }
      }}
      className={`group bg-accent/60 hover:bg-primary/5 flex cursor-pointer flex-col rounded-md text-left transition-colors ${
        active ? "ring-primary ring-1" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-muted-foreground [&>svg]:size-3.5">{icon}</span>
          <span className="text-muted-foreground truncate font-mono text-[11px] font-medium tracking-wide">
            {label}
          </span>
        </span>
        <span className="border-border bg-background text-muted-foreground group-hover:border-primary/40 group-hover:text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded border">
          <Pencil className="size-3" />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1 px-3 pb-3 pt-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="text-muted-foreground truncate text-xs">{provider}</div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <div className="grid gap-0.5">
            <span className="text-muted-foreground text-[10px] font-medium tracking-wide underline decoration-dotted underline-offset-2">
              Latency
            </span>
            <span className="font-mono text-xs">{latency}</span>
          </div>
          <div className="grid gap-0.5">
            <span className="text-muted-foreground text-[10px] font-medium tracking-wide underline decoration-dotted underline-offset-2">
              Cost
            </span>
            <span className="font-mono text-xs">{cost}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentForm({
  workspaceId,
  agentId,
  initialName = "",
  initialDescription = "",
  initialConfig,
  status = "draft",
}: AgentFormProps) {
  const navigate = useNavigate();
  const createAgent = useMutation(api.agents.create);
  const saveAgent = useMutation(api.agents.save);
  const publishAgent = useAction(api.agents.publish);
  const archiveAgent = useMutation(api.agents.archive);
  const askCopilot = useAction(api.copilot.chat);
  const generateConfig = useAction(api.copilot.generateConfig);

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [config, setConfig] = useState<AgentConfig>(initialConfig);
  const [activeEditor, setActiveEditor] = useState<ComponentKey | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [copilotAnswer, setCopilotAnswer] = useState<string | null>(null);
  const [promptSuggestion, setPromptSuggestion] = useState<string | null>(null);

  const estimate = estimateAgent(config);
  const promptTokens = estimateTokens(config.systemPrompt);

  const payload = {
    name,
    description: description.trim() || undefined,
    config,
  };

  async function handleSave() {
    if (name.trim().length === 0) {
      toast.error("Give the agent a name before saving.");
      return;
    }

    setIsSaving(true);
    try {
      if (agentId) {
        await saveAgent({ agentId, ...payload });
        toast.success("Draft saved");
      } else {
        const id = await createAgent({ workspaceId, ...payload });
        toast.success("Agent created");
        await navigate({ to: "/sarvam/agents/$agentId", params: { agentId: id } });
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublish() {
    if (name.trim().length === 0) {
      toast.error("Give the agent a name before publishing.");
      return;
    }

    setIsPublishing(true);
    try {
      let id = agentId;
      if (id) {
        await saveAgent({ agentId: id, ...payload });
      } else {
        id = await createAgent({ workspaceId, ...payload });
      }

      const result = await publishAgent({ agentId: id });
      toast.success(
        result.runtime === "cloudflare" ? "Published to the Cloudflare voice runtime" : "Published",
      );

      if (!agentId) {
        await navigate({ to: "/sarvam/agents/$agentId", params: { agentId: id } });
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleArchive() {
    if (!agentId) {
      return;
    }
    if (!window.confirm("Archive this agent? The local record is kept.")) {
      return;
    }

    setIsArchiving(true);
    try {
      await archiveAgent({ agentId });
      toast.success("Agent archived");
      await navigate({ to: "/sarvam/agents" });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleGeneratePrompt() {
    setIsThinking(true);
    setPromptSuggestion(null);
    try {
      const result = await askCopilot({
        workspaceId,
        prompt:
          "Rewrite the system prompt to be concise, warm, and easy to speak. Keep the same role and constraints. Return only the prompt text.",
        context: JSON.stringify({ name, description, config }, null, 2),
      });
      setPromptSuggestion(result.text);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsThinking(false);
    }
  }

  async function handleCopilot() {
    const prompt = copilotPrompt.trim();
    if (!prompt) {
      return;
    }

    setIsThinking(true);
    setCopilotAnswer(null);
    try {
      const result = await askCopilot({
        workspaceId,
        prompt,
        context: JSON.stringify({ name, description, config }, null, 2),
      });
      setCopilotAnswer(result.text);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsThinking(false);
    }
  }

  async function handleGenerateConfig() {
    const prompt = copilotPrompt.trim();
    if (!prompt) {
      toast.error("Describe the voice agent you want first.");
      return;
    }

    setIsThinking(true);
    setCopilotAnswer(null);
    try {
      const generated = await generateConfig({
        workspaceId,
        prompt,
        context: JSON.stringify({ name, description, config }, null, 2),
      });
      setName(generated.name);
      setDescription(generated.description);
      setConfig((current) => ({
        firstMessage: generated.firstMessage,
        firstMessageMode: generated.firstMessageMode,
        systemPrompt: generated.systemPrompt,
        model: generated.model,
        voice: generated.voice,
        transcriber: generated.transcriber,
        tools: generated.tools ?? current.tools ?? [],
        turnTaking: generated.turnTaking ?? current.turnTaking,
      }));
      setCopilotAnswer(
        `Generated a full configuration for "${generated.name}". Review the prompt and publish when ready.`,
      );
      toast.success("Agent configuration generated");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsThinking(false);
    }
  }

  function applySarvamPreset() {
    setConfig((current) => ({
      ...current,
      model: {
        provider: "sarvam",
        model: "sarvam-105b",
        temperature: 0.4,
        maxTokens: 220,
      },
      transcriber: {
        provider: "sarvam",
        model: "saaras:v4",
        language: current.transcriber.language === "en" ? "en-IN" : "unknown",
        mode: "codemix",
      },
      voice: {
        provider: "sarvam",
        voiceId: "shubh",
        model: "bulbul:v3",
      },
    }));
    toast.success("Sarvam STT/TTS + Sarvam-105B selected");
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Pricing assistant"
              maxLength={80}
              aria-invalid={name.trim().length === 0}
            />
            {name.trim().length === 0 ? (
              <p className="text-destructive text-[11px]">Name is required.</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-description">Description</Label>
            <Input
              id="agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Answers pricing questions for inbound calls"
            />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label>Runtime</Label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border px-3 py-1 text-xs">
                Cloudflare voice runtime + Sarvam
              </span>
              <Button type="button" variant="ghost" onClick={applySarvamPreset}>
                <Sparkles /> Use Sarvam stack
              </Button>
            </div>
            <p className="text-muted-foreground text-[11px]">
              Agents run on the Cloudflare voice runtime with Sarvam STT/TTS and the selected LLM.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="grid gap-4 px-3 pb-3 pt-4 md:grid-cols-2 md:gap-6">
          <MetricBlock
            label="Cost"
            value={formatCostPerMinute(estimate.totalCostPerMinute)}
            components={estimate.components}
            metric="costPerMinute"
          />
          <MetricBlock
            label="Latency"
            value={formatLatency(estimate.totalLatencyMs)}
            components={estimate.components}
            metric="latencyMs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <span
            className="text-muted-foreground shrink-0 text-xs font-medium underline decoration-dotted underline-offset-4"
            title="Presets only change builder settings; publish to apply them on the runtime"
          >
            Model Presets
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {MODEL_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="sm"
                title={preset.description}
                onClick={() => setConfig((current) => preset.apply(current))}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <span className="text-muted-foreground ml-auto text-xs italic">Customized</span>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <AssistantCard
          icon={<Mic />}
          label="TRANSCRIBER"
          name={config.transcriber.model}
          provider={`${config.transcriber.provider} · ${config.transcriber.language}`}
          cost={formatCostPerMinute(estimate.components[1].costPerMinute, 3)}
          latency={formatLatency(estimate.components[1].latencyMs)}
          active={activeEditor === "transcriber"}
          onEdit={() => setActiveEditor(activeEditor === "transcriber" ? null : "transcriber")}
        />
        <AssistantCard
          icon={<Cpu />}
          label="MODEL"
          name={config.model.model}
          provider={config.model.provider}
          cost={formatCostPerMinute(estimate.components[2].costPerMinute)}
          latency={formatLatency(estimate.components[2].latencyMs)}
          active={activeEditor === "model"}
          onEdit={() => setActiveEditor(activeEditor === "model" ? null : "model")}
        />
        <AssistantCard
          icon={<Volume2 />}
          label="VOICE"
          name={config.voice.voiceId}
          provider={config.voice.provider}
          cost={formatCostPerMinute(estimate.components[3].costPerMinute)}
          latency={formatLatency(estimate.components[3].latencyMs)}
          active={activeEditor === "voice"}
          onEdit={() => setActiveEditor(activeEditor === "voice" ? null : "voice")}
        />
      </div>

      {activeEditor ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>
                {activeEditor === "transcriber"
                  ? "Transcriber settings"
                  : activeEditor === "model"
                    ? "Model settings"
                    : "Voice settings"}
              </CardTitle>
              <CardDescription>
                These values are sent to the voice runtime when you publish.
              </CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveEditor(null)}>
              Done
            </Button>
          </CardHeader>
          <CardContent>
            {activeEditor === "transcriber" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="transcriber-provider">Provider</Label>
                  <Input
                    id="transcriber-provider"
                    value={config.transcriber.provider}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        transcriber: { ...current.transcriber, provider: event.target.value },
                      }))
                    }
                    placeholder="deepgram"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="transcriber-model">Model</Label>
                  <Input
                    id="transcriber-model"
                    value={config.transcriber.model}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        transcriber: { ...current.transcriber, model: event.target.value },
                      }))
                    }
                    placeholder="nova-3"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="transcriber-language">Language</Label>
                  <Input
                    id="transcriber-language"
                    value={config.transcriber.language}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        transcriber: { ...current.transcriber, language: event.target.value },
                      }))
                    }
                    placeholder="en"
                  />
                </div>
              </div>
            ) : null}

            {activeEditor === "model" ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="model-provider">Provider</Label>
                  <Input
                    id="model-provider"
                    value={config.model.provider}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        model: { ...current.model, provider: event.target.value },
                      }))
                    }
                    placeholder="openai"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="model-name">Model</Label>
                  <Input
                    id="model-name"
                    value={config.model.model}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        model: { ...current.model, model: event.target.value },
                      }))
                    }
                    placeholder="gpt-4o-mini"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="model-temperature">Temperature</Label>
                  <Input
                    id="model-temperature"
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={config.model.temperature}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        model: { ...current.model, temperature: Number(event.target.value) || 0 },
                      }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="model-max-tokens">Max tokens</Label>
                  <Input
                    id="model-max-tokens"
                    type="number"
                    min={32}
                    max={4096}
                    value={config.model.maxTokens}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        model: { ...current.model, maxTokens: Number(event.target.value) || 0 },
                      }))
                    }
                  />
                </div>
              </div>
            ) : null}

            {activeEditor === "voice" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="voice-provider">Provider</Label>
                  <Input
                    id="voice-provider"
                    value={config.voice.provider}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        voice: { ...current.voice, provider: event.target.value },
                      }))
                    }
                    placeholder="11labs"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="voice-id">Voice ID</Label>
                  <Input
                    id="voice-id"
                    value={config.voice.voiceId}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        voice: { ...current.voice, voiceId: event.target.value },
                      }))
                    }
                    placeholder="burt"
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>System prompt</CardTitle>
                <CardDescription>
                  Describe the role, tone, constraints, and when to end the call.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{promptTokens} tokens</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleGeneratePrompt()}
                  disabled={isThinking}
                >
                  {isThinking ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Generate
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Textarea
              value={config.systemPrompt}
              onChange={(event) =>
                setConfig((current) => ({ ...current, systemPrompt: event.target.value }))
              }
              className="min-h-80 font-mono text-xs leading-relaxed"
              placeholder="You are a warm, professional inbound voice receptionist..."
            />
            <p className="text-muted-foreground text-[11px]">
              Tip: write one instruction per paragraph and keep it under a minute of speech.
            </p>

            {promptSuggestion ? (
              <div className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Copilot suggestion</span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setConfig((current) => ({ ...current, systemPrompt: promptSuggestion }));
                      setPromptSuggestion(null);
                      toast.success("Prompt suggestion applied");
                    }}
                  >
                    Apply
                  </Button>
                </div>
                <pre className="max-h-56 overflow-auto text-xs whitespace-pre-wrap">
                  {promptSuggestion}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>First message</CardTitle>
              <CardDescription>What the caller hears when the call connects.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="first-message-mode">Mode</Label>
                <select
                  id="first-message-mode"
                  className="border-input bg-background h-8 rounded-none border px-2 text-xs"
                  value={config.firstMessageMode ?? "assistant-speaks-first"}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      firstMessageMode: event.target.value as AgentConfig["firstMessageMode"],
                    }))
                  }
                >
                  {FIRST_MESSAGE_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="first-message">Message</Label>
                <Textarea
                  id="first-message"
                  value={config.firstMessage}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, firstMessage: event.target.value }))
                  }
                  placeholder="Thank you for calling. How may I help you today?"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4" /> Files
              </CardTitle>
              <CardDescription>Attach reference files to the assistant.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button type="button" variant="outline" disabled className="w-full justify-between">
                Select files
                <FileText />
              </Button>
              <p className="text-muted-foreground text-[11px]">
                File-backed knowledge is not wired to the voice runtime yet.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot /> Builder copilot
          </CardTitle>
          <CardDescription>
            Describe the agent you want and generate a complete name, prompt, first message, model,
            voice, and transcriber configuration. Powered by the Convex AI Gateway and rate-limited
            per user.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Textarea
            value={copilotPrompt}
            onChange={(event) => setCopilotPrompt(event.target.value)}
            placeholder="Describe the voice agent you want, e.g. a Hindi/English receptionist that takes messages and books callbacks."
            className="min-h-24"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void handleGenerateConfig()}
              disabled={isThinking || !copilotPrompt.trim()}
            >
              {isThinking ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Generate config
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleCopilot()}
              disabled={isThinking || !copilotPrompt.trim()}
            >
              {isThinking ? <Loader2 className="animate-spin" /> : <Bot />}
              Ask copilot
            </Button>
          </div>
          {copilotAnswer ? (
            <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {copilotAnswer}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <div className="bg-background/95 sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t px-4 py-3 backdrop-blur">
        <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
          {status}
        </span>
        <Button onClick={() => void handleSave()} disabled={isSaving || isPublishing}>
          {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
          Save draft
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handlePublish()}
          disabled={isSaving || isPublishing}
        >
          {isPublishing ? <Loader2 className="animate-spin" /> : <Upload />}
          Publish
        </Button>
        {agentId ? (
          <Link
            to="/sarvam/voice"
            search={{ agent: agentId }}
            className={buttonVariants({ variant: "outline" })}
          >
            <ExternalLink /> Test call
          </Link>
        ) : null}
        {agentId ? (
          <span className="text-muted-foreground hidden font-mono text-[11px] md:inline">
            {agentId}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {agentId ? (
            <Button
              variant="destructive"
              onClick={() => void handleArchive()}
              disabled={isArchiving}
            >
              {isArchiving ? <Loader2 className="animate-spin" /> : <Archive />}
              Archive
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
