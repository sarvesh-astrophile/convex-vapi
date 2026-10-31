import { buttonVariants } from "@convex-vapi/ui/components/button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";

import { AgentForm } from "@/components/agent-form";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent-defaults";

export const Route = createFileRoute("/sarvam/agents/new")({
  component: NewAgentPage,
});

function NewAgentPage() {
  const { workspace, isLoading } = useActiveWorkspace();

  if (isLoading || !workspace) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm">
        <Loader2 className="animate-spin" />
        {workspace === null ? "Setting up your workspace…" : "Loading workspace…"}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-4 px-4 pb-8 pt-4">
      <div>
        <Link
          to="/sarvam/agents"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          <ArrowLeft /> Agents
        </Link>
      </div>
      <AgentForm workspaceId={workspace._id} initialConfig={DEFAULT_AGENT_CONFIG} />
    </div>
  );
}
