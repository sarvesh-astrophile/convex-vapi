import { api } from "@convex-vapi/backend/convex/_generated/api";
import type { Id } from "@convex-vapi/backend/convex/_generated/dataModel";
import { buttonVariants } from "@convex-vapi/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@convex-vapi/ui/components/card";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { AgentForm } from "@/components/agent-form";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent-defaults";
import { formatTimestamp } from "@/lib/format";

export const Route = createFileRoute("/_auth/agents/$agentId")({
  component: AgentDetailPage,
});

function AgentDetailPage() {
  const { agentId } = Route.useParams();
  const { workspace, isLoading } = useActiveWorkspace();
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(
    api.agents.get,
    isAuthenticated ? { agentId: agentId as Id<"agents"> } : "skip",
  );

  if (isLoading || !workspace || result === undefined) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm">
        <Loader2 className="animate-spin" />
        Loading agent…
      </div>
    );
  }

  if (result === null) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="font-medium">Agent not found</p>
        <p className="text-muted-foreground mt-1 text-sm">
          It may belong to another workspace or have been removed.
        </p>
        <Link
          to="/agents"
          className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}
        >
          <ArrowLeft /> Back to agents
        </Link>
      </div>
    );
  }

  const { agent, currentVersion, versions } = result;
  const hasUnpublishedChanges =
    agent.publishedVersionId !== undefined &&
    agent.currentVersionId !== undefined &&
    agent.currentVersionId !== agent.publishedVersionId;

  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-4 px-4 pb-8 pt-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/agents"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          <ArrowLeft /> Agents
        </Link>
        {hasUnpublishedChanges ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs">
            Unpublished changes
          </span>
        ) : null}
      </div>

      <AgentForm
        workspaceId={agent.workspaceId}
        agentId={agent._id}
        initialName={agent.name}
        initialDescription={agent.description ?? ""}
        initialConfig={currentVersion?.config ?? DEFAULT_AGENT_CONFIG}
        status={agent.status}
      />

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>
            Every save creates a new immutable configuration version. Publishing marks one as live
            on the Cloudflare runtime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {versions.map((version) => (
              <li key={version._id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">v{version.version}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatTimestamp(version.createdAt)}
                  </p>
                </div>
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  {version._id === agent.publishedVersionId ? (
                    <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-emerald-600 dark:text-emerald-400">
                      Published
                    </span>
                  ) : null}
                  {version._id === agent.currentVersionId ? (
                    <span className="rounded-full border px-2 py-0.5">Current draft</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
