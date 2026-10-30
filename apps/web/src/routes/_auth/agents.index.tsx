import { api } from "@convex-vapi/backend/convex/_generated/api";
import { buttonVariants } from "@convex-vapi/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@convex-vapi/ui/components/card";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus } from "lucide-react";

import { useActiveWorkspace, useWorkspaces } from "@/hooks/use-active-workspace";
import { formatTimestamp } from "@/lib/format";

export const Route = createFileRoute("/_auth/agents/")({
  component: AgentsPage,
});

function AgentsPage() {
  const { workspace, isLoading } = useActiveWorkspace();
  const workspaces = useWorkspaces();
  const setActive = useMutation(api.workspaces.setActive);
  const agents = useQuery(api.agents.list, workspace ? { workspaceId: workspace._id } : "skip");

  if (isLoading || !workspace) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm">
        <Loader2 className="animate-spin" />
        {workspace === null ? "Setting up your workspace…" : "Loading workspace…"}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-6 px-4 pb-8 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium">Agents</h1>
          <p className="text-muted-foreground text-sm">
            Build assistant configurations in Convex and publish them to Vapi.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspaces && workspaces.length > 1 ? (
            <select
              className="border-input bg-background h-8 rounded-none border px-2 text-xs"
              value={workspace._id}
              onChange={(event) => {
                void setActive({ workspaceId: event.target.value as typeof workspace._id });
              }}
            >
              {workspaces.map((entry) => (
                <option key={entry.workspace._id} value={entry.workspace._id}>
                  {entry.workspace.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-muted-foreground text-xs">{workspace.name}</span>
          )}
          <Link to="/agents/new" className={buttonVariants({ size: "sm" })}>
            <Plus /> New agent
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your agents</CardTitle>
          <CardDescription>
            Drafts are versioned in Convex. Publishing creates or updates the Vapi assistant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {agents === undefined ? (
            <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
              <Loader2 className="animate-spin" /> Loading agents…
            </div>
          ) : agents.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium">No agents yet</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Create an assistant, publish it, and test it with your microphone.
              </p>
              <Link
                to="/agents/new"
                className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}
              >
                <Plus /> Create your first agent
              </Link>
            </div>
          ) : (
            <ul className="divide-y">
              {agents.map((agent) => (
                <li key={agent._id}>
                  <Link
                    to="/agents/$agentId"
                    params={{ agentId: agent._id }}
                    className="hover:bg-muted/50 grid gap-2 rounded-sm px-2 py-4 transition-colors sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{agent.name}</p>
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        {agent.description ?? "No description"} · updated{" "}
                        {formatTimestamp(agent.updatedAt)}
                      </p>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-3 text-xs sm:justify-end">
                      {agent.vapiAssistantId ? (
                        <span className="font-mono">{agent.vapiAssistantId}</span>
                      ) : null}
                      <span className="rounded-full border px-2 py-0.5">{agent.status}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
