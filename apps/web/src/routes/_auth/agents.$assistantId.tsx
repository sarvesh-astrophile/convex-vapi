import { api } from "@convex-vapi/backend/convex/_generated/api";
import type { Id } from "@convex-vapi/backend/convex/_generated/dataModel";
import { buttonVariants } from "@convex-vapi/ui/components/button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { BuilderChat } from "@/components/vapi-builder/builder-chat";
import { VapiAssistantDraftPanel } from "@/components/vapi-builder/draft-panel";

export const Route = createFileRoute("/_auth/agents/$assistantId")({
  component: VapiAssistantBuilderPage,
});

function VapiAssistantBuilderPage() {
  const { assistantId } = Route.useParams();
  const typedId = assistantId as Id<"vapiAssistants">;
  const assistant = useQuery(api.vapiAssistants.get, { assistantId: typedId });

  if (assistant === undefined) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm">
        <Loader2 className="animate-spin" /> Loading assistant…
      </div>
    );
  }

  if (assistant === null) {
    return (
      <div className="mx-auto grid w-full max-w-xl place-items-center gap-3 py-24 text-center">
        <p className="text-sm font-medium">Assistant not found</p>
        <p className="text-muted-foreground text-sm">
          It may have been removed, or it belongs to another workspace.
        </p>
        <Link to="/agents" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <ArrowLeft /> Back to assistants
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-4 px-4 pb-8 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/agents" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft /> All assistants
        </Link>
        <p className="text-muted-foreground text-xs">
          Chat changes are saved to the draft automatically. Publish when it looks right.
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <BuilderChat assistantId={typedId} assistantName={assistant.name} />
        <VapiAssistantDraftPanel assistant={assistant} />
      </div>
    </div>
  );
}
