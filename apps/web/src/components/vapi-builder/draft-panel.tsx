import { api } from "@convex-vapi/backend/convex/_generated/api";
import type { Doc } from "@convex-vapi/backend/convex/_generated/dataModel";
import type { VapiAssistantConfig } from "@convex-vapi/backend/convex/lib/vapiAssistantConfig";
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
import { Archive, ExternalLink, Loader2, Save, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/errors";
import { formatTimestamp } from "@/lib/format";

const FIRST_MESSAGE_MODES = [
  { value: "assistant-speaks-first", label: "Assistant speaks first" },
  { value: "assistant-waits-for-user", label: "Assistant waits for user" },
  {
    value: "assistant-speaks-first-with-model-generated-message",
    label: "Assistant generates first message",
  },
] as const;

const MODEL_PROVIDERS = ["openai", "anthropic", "google", "groq", "together-ai"];
const VOICE_PROVIDERS = ["vapi", "11labs", "azure", "openai", "cartesia"];
const TRANSCRIBER_PROVIDERS = ["deepgram", "assembly-ai", "openai", "soniox", "gladia"];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-[10px] leading-relaxed">{hint}</p> : null}
    </div>
  );
}

export function VapiAssistantDraftPanel({ assistant }: { assistant: Doc<"vapiAssistants"> }) {
  const navigate = useNavigate();
  const save = useMutation(api.vapiAssistants.save);
  const publish = useAction(api.vapiAssistants.publish);
  const archive = useMutation(api.vapiAssistants.archive);

  const [name, setName] = useState(assistant.name);
  const [description, setDescription] = useState(assistant.description ?? "");
  const [config, setConfig] = useState<VapiAssistantConfig>(assistant.config);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  // Chat turns update the row; keep the form in sync with the stored draft.
  // Only resync when the stored draft actually changed, so typing is not
  // interrupted by unrelated reactive re-renders.
  const syncedUpdatedAtRef = useRef(assistant.updatedAt);
  useEffect(() => {
    if (syncedUpdatedAtRef.current === assistant.updatedAt) {
      return;
    }
    syncedUpdatedAtRef.current = assistant.updatedAt;
    setName(assistant.name);
    setDescription(assistant.description ?? "");
    setConfig(assistant.config);
  }, [assistant]);

  const hasUnpublishedChanges =
    assistant.publishedAt !== undefined && assistant.updatedAt > assistant.publishedAt;
  const isPublished = assistant.status === "published";
  const isArchived = assistant.status === "archived";

  function updateConfig(patch: Partial<VapiAssistantConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function updateModel(patch: Partial<VapiAssistantConfig["model"]>) {
    setConfig((current) => ({ ...current, model: { ...current.model, ...patch } }));
  }

  function updateVoice(patch: Partial<VapiAssistantConfig["voice"]>) {
    setConfig((current) => ({ ...current, voice: { ...current.voice, ...patch } }));
  }

  function updateTranscriber(patch: Partial<VapiAssistantConfig["transcriber"]>) {
    setConfig((current) => ({
      ...current,
      transcriber: { ...current.transcriber, ...patch },
    }));
  }

  async function persistDraft() {
    if (name.trim().length === 0) {
      throw new Error("Give the assistant a name first.");
    }
    await save({
      assistantId: assistant._id,
      name,
      description,
      config,
    });
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await persistDraft();
      toast.success("Draft saved");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublish() {
    setIsPublishing(true);
    try {
      await persistDraft();
      const result = await publish({ assistantId: assistant._id });
      toast.success(
        result.created ? "Published a new assistant to Vapi" : "Updated the assistant in Vapi",
        {
          description: (
            <a
              href={result.vapiDashboardUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Open in the Vapi dashboard
            </a>
          ),
        },
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleArchive() {
    if (!window.confirm("Archive this assistant? The Vapi assistant itself is not deleted.")) {
      return;
    }
    setIsArchiving(true);
    try {
      await archive({ assistantId: assistant._id });
      toast.success("Assistant archived");
      await navigate({ to: "/agents" });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsArchiving(false);
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Assistant draft</CardTitle>
            <CardDescription>
              Review and fine-tune what the copilot produced, then publish to Vapi.
            </CardDescription>
          </div>
          <StatusPill status={assistant.status} hasUnpublishedChanges={hasUnpublishedChanges} />
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 pt-4">
        {isArchived ? (
          <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-sm border px-3 py-2 text-xs">
            This assistant is archived. Create a new assistant to keep building.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" hint="Vapi limits names to 40 characters.">
            <Input
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              disabled={isArchived}
            />
          </Field>
          <Field label="Description" hint="Shown only in this app.">
            <Input
              value={description}
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this assistant does"
              disabled={isArchived}
            />
          </Field>
        </div>

        <Field label="First message" hint="Spoken as soon as the call connects.">
          <Textarea
            value={config.firstMessage}
            rows={2}
            maxLength={1_000}
            onChange={(event) => updateConfig({ firstMessage: event.target.value })}
            disabled={isArchived}
          />
        </Field>

        <Field label="First message mode">
          <select
            className="border-input bg-background focus-visible:border-ring h-8 w-full rounded-none border px-2 text-xs outline-none disabled:opacity-50"
            value={config.firstMessageMode}
            onChange={(event) =>
              updateConfig({
                firstMessageMode: event.target.value as VapiAssistantConfig["firstMessageMode"],
              })
            }
            disabled={isArchived}
          >
            {FIRST_MESSAGE_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="System prompt" hint="Becomes the Vapi model's system message.">
          <Textarea
            value={config.systemPrompt}
            rows={7}
            maxLength={12_000}
            onChange={(event) => updateConfig({ systemPrompt: event.target.value })}
            disabled={isArchived}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Model provider">
            <Input
              list="vapi-model-providers"
              value={config.model.provider}
              onChange={(event) => updateModel({ provider: event.target.value })}
              disabled={isArchived}
            />
            <datalist id="vapi-model-providers">
              {MODEL_PROVIDERS.map((provider) => (
                <option key={provider} value={provider} />
              ))}
            </datalist>
          </Field>
          <Field label="Model">
            <Input
              value={config.model.model}
              onChange={(event) => updateModel({ model: event.target.value })}
              placeholder="gpt-4o-mini"
              disabled={isArchived}
            />
          </Field>
          <Field label="Temperature">
            <Input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={config.model.temperature}
              onChange={(event) => updateModel({ temperature: Number(event.target.value) })}
              disabled={isArchived}
            />
          </Field>
          <Field label="Max tokens">
            <Input
              type="number"
              min={32}
              max={4096}
              value={config.model.maxTokens}
              onChange={(event) => updateModel({ maxTokens: Number(event.target.value) })}
              disabled={isArchived}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Voice provider">
            <Input
              list="vapi-voice-providers"
              value={config.voice.provider}
              onChange={(event) => updateVoice({ provider: event.target.value })}
              disabled={isArchived}
            />
            <datalist id="vapi-voice-providers">
              {VOICE_PROVIDERS.map((provider) => (
                <option key={provider} value={provider} />
              ))}
            </datalist>
          </Field>
          <Field label="Voice id">
            <Input
              value={config.voice.voiceId}
              onChange={(event) => updateVoice({ voiceId: event.target.value })}
              placeholder="Elliot"
              disabled={isArchived}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Transcriber provider">
            <Input
              list="vapi-transcriber-providers"
              value={config.transcriber.provider}
              onChange={(event) => updateTranscriber({ provider: event.target.value })}
              disabled={isArchived}
            />
            <datalist id="vapi-transcriber-providers">
              {TRANSCRIBER_PROVIDERS.map((provider) => (
                <option key={provider} value={provider} />
              ))}
            </datalist>
          </Field>
          <Field label="Transcriber model">
            <Input
              value={config.transcriber.model}
              onChange={(event) => updateTranscriber({ model: event.target.value })}
              placeholder="nova-3"
              disabled={isArchived}
            />
          </Field>
          <Field label="Language">
            <Input
              value={config.transcriber.language}
              onChange={(event) => updateTranscriber({ language: event.target.value })}
              placeholder="en"
              disabled={isArchived}
            />
          </Field>
        </div>

        <details className="rounded-sm border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Call behavior</summary>
          <div className="grid gap-3 border-t p-3">
            <Field label="End call message">
              <Input
                value={config.endCallMessage ?? ""}
                maxLength={1_000}
                onChange={(event) => updateConfig({ endCallMessage: event.target.value })}
                placeholder="Thanks for calling. Goodbye!"
                disabled={isArchived}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Max duration (seconds)" hint="Vapi range: 10–43200.">
                <Input
                  type="number"
                  min={10}
                  max={43200}
                  value={config.maxDurationSeconds ?? ""}
                  onChange={(event) =>
                    updateConfig({
                      maxDurationSeconds:
                        event.target.value === "" ? undefined : Number(event.target.value),
                    })
                  }
                  disabled={isArchived}
                />
              </Field>
              <Field label="Silence timeout (seconds)" hint="Vapi hangs up after this silence.">
                <Input
                  type="number"
                  min={5}
                  max={120}
                  value={config.silenceTimeoutSeconds ?? ""}
                  onChange={(event) =>
                    updateConfig({
                      silenceTimeoutSeconds:
                        event.target.value === "" ? undefined : Number(event.target.value),
                    })
                  }
                  disabled={isArchived}
                />
              </Field>
            </div>
          </div>
        </details>

        <div className="grid gap-3 border-t pt-4">
          {assistant.vapiAssistantId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">Published to Vapi</p>
                <p className="text-muted-foreground truncate font-mono text-[10px]">
                  {assistant.vapiAssistantId}
                </p>
                {assistant.publishedAt ? (
                  <p className="text-muted-foreground mt-0.5 text-[10px]">
                    {formatTimestamp(assistant.publishedAt)}
                  </p>
                ) : null}
              </div>
              <a
                href={`https://dashboard.vapi.ai/assistants/${assistant.vapiAssistantId}`}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ExternalLink /> Vapi
              </a>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Not published yet. Publishing creates the assistant in your Vapi account and points
              its webhook at this deployment so calls show up in{" "}
              <Link to="/calls" className="underline">
                call history
              </Link>
              .
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || isPublishing || isArchived}
            >
              {isSaving ? <Loader2 className="animate-spin" /> : <Save />} Save draft
            </Button>
            <Button
              type="button"
              onClick={() => void handlePublish()}
              disabled={isSaving || isPublishing || isArchived}
            >
              {isPublishing ? <Loader2 className="animate-spin" /> : <Upload />}
              {isPublished ? "Publish changes" : "Publish to Vapi"}
            </Button>
            {!isArchived ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleArchive()}
                disabled={isSaving || isPublishing || isArchiving}
              >
                {isArchiving ? <Loader2 className="animate-spin" /> : <Archive />} Archive
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({
  status,
  hasUnpublishedChanges,
}: {
  status: Doc<"vapiAssistants">["status"];
  hasUnpublishedChanges: boolean;
}) {
  if (status === "archived") {
    return (
      <span className="border-destructive/30 bg-destructive/10 text-destructive rounded-full border px-2 py-0.5 text-[10px] font-medium">
        Archived
      </span>
    );
  }
  if (status === "published" && !hasUnpublishedChanges) {
    return (
      <span className="rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        Published
      </span>
    );
  }
  if (status === "published") {
    return (
      <span className="rounded-full border border-amber-600/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        Unpublished changes
      </span>
    );
  }
  return (
    <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] font-medium">
      Draft
    </span>
  );
}
