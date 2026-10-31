import { api } from "@convex-vapi/backend/convex/_generated/api";
import { Button, buttonVariants } from "@convex-vapi/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@convex-vapi/ui/components/card";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Loader2, MessageSquarePlus, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { errorMessage } from "@/lib/errors";
import { formatTimestamp } from "@/lib/format";

export const Route = createFileRoute("/_auth/agents/")({
  component: VapiAssistantsPage,
});

function statusLabel(status: "draft" | "published" | "archived", hasChanges: boolean) {
  if (status === "archived") return "Archived";
  if (status === "published") return hasChanges ? "Unpublished changes" : "Published";
  return "Draft";
}

function VapiAssistantsPage() {
  const navigate = useNavigate();
  const { workspace, isLoading } = useActiveWorkspace();
  const createAssistant = useMutation(api.vapiAssistants.create);
  const assistants = useQuery(
    api.vapiAssistants.list,
    workspace ? { workspaceId: workspace._id } : "skip",
  );
  const [isCreating, setIsCreating] = useState(false);

  if (isLoading || !workspace) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm">
        <Loader2 className="animate-spin" />
        {workspace === null ? "Setting up your workspace…" : "Loading workspace…"}
      </div>
    );
  }

  async function handleCreate() {
    if (!workspace) return;
    setIsCreating(true);
    try {
      const assistantId = await createAssistant({ workspaceId: workspace._id });
      await navigate({ to: "/agents/$assistantId", params: { assistantId } });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-6 px-4 pb-8 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium">Vapi assistant builder</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Chat with a Convex agent to design an assistant, then publish it to Vapi. Calls from
            published assistants flow back into this workspace through the Vapi webhook.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => void handleCreate()} disabled={isCreating}>
          {isCreating ? <Loader2 className="animate-spin" /> : <Plus />} New assistant
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Vapi assistants</CardTitle>
          <CardDescription>
            Drafts and published assistants are scoped to the active workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assistants === undefined ? (
            <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
              <Loader2 className="animate-spin" /> Loading assistants…
            </div>
          ) : assistants.length === 0 ? (
            <div className="grid place-items-center gap-2 py-16 text-center">
              <MessageSquarePlus className="text-muted-foreground size-8" />
              <p className="text-sm font-medium">No assistants yet</p>
              <p className="text-muted-foreground max-w-sm text-sm">
                Describe the voice agent you want in plain English. The builder writes the Vapi
                configuration for you.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void handleCreate()}
                disabled={isCreating}
              >
                {isCreating ? <Loader2 className="animate-spin" /> : <Plus />} Create your first
                assistant
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {assistants.map((assistant) => {
                const hasChanges =
                  assistant.publishedAt !== undefined &&
                  assistant.updatedAt > assistant.publishedAt;
                return (
                  <li
                    key={assistant._id}
                    className="hover:bg-muted/50 grid gap-2 rounded-sm px-2 py-4 transition-colors sm:grid-cols-[1fr_auto]"
                  >
                    <Link
                      to="/agents/$assistantId"
                      params={{ assistantId: assistant._id }}
                      className="min-w-0"
                    >
                      <p className="truncate text-sm font-medium">{assistant.name}</p>
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        {assistant.description ?? "No description"} · updated{" "}
                        {formatTimestamp(assistant.updatedAt)}
                      </p>
                      {assistant.vapiAssistantId ? (
                        <p className="text-muted-foreground mt-0.5 truncate font-mono text-[10px]">
                          {assistant.vapiAssistantId}
                        </p>
                      ) : null}
                    </Link>
                    <div className="flex items-center gap-2 text-xs sm:justify-end">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          assistant.status === "published" && !hasChanges
                            ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700"
                            : assistant.status === "published"
                              ? "border-amber-600/30 bg-amber-500/10 text-amber-700"
                              : assistant.status === "archived"
                                ? "border-destructive/30 bg-destructive/10 text-destructive"
                                : ""
                        }`}
                      >
                        {statusLabel(assistant.status, hasChanges)}
                      </span>
                      {assistant.vapiAssistantId ? (
                        <a
                          href={`https://dashboard.vapi.ai/assistants/${assistant.vapiAssistantId}`}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                          aria-label="Open in Vapi"
                        >
                          <ExternalLink />
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
