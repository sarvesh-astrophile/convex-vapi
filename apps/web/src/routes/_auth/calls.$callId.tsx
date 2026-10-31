import { api } from "@convex-vapi/backend/convex/_generated/api";
import { Button, buttonVariants } from "@convex-vapi/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@convex-vapi/ui/components/card";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/errors";
import { formatCost, formatDuration, formatTimestamp } from "@/lib/format";

export const Route = createFileRoute("/_auth/calls/$callId")({
  component: VapiCallDetailPage,
});

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</span>
      <span className="break-all text-sm">{value}</span>
    </div>
  );
}

function VapiCallDetailPage() {
  const { callId } = Route.useParams();
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(api.vapi.get, isAuthenticated ? { callId } : "skip");
  const refreshCall = useAction(api.vapi.refresh);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await refreshCall({ callId });
      toast.success("Refreshed from Vapi");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  if (result === undefined) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-20 text-sm">
        <Loader2 className="animate-spin" /> Loading call…
      </div>
    );
  }

  if (result === null) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="font-medium">Call not found</p>
        <p className="text-muted-foreground mt-1 text-sm">
          It may belong to another workspace or the webhook has not arrived yet.
        </p>
        <Link
          to="/calls"
          className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}
        >
          <ArrowLeft /> Back to calls
        </Link>
      </div>
    );
  }

  const { call, owner } = result;

  return (
    <div className="container mx-auto grid max-w-4xl gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/calls"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          <ArrowLeft /> Calls
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          {isRefreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Refresh from Vapi
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{call.summary ?? `Call to ${owner.customerNumber}`}</CardTitle>
              <CardDescription className="font-mono text-[11px]">{call.callId}</CardDescription>
            </div>
            <span className="rounded-full border px-2 py-0.5 text-xs">{call.status}</span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Started" value={formatTimestamp(call.startedAt)} />
            <Field label="Ended" value={formatTimestamp(call.endedAt)} />
            <Field label="Duration" value={formatDuration(call.startedAt, call.endedAt)} />
            <Field label="Cost" value={formatCost(call.cost)} />
            <Field label="Ended reason" value={call.endedReason ?? "—"} />
            <Field label="Assistant" value={call.assistantId ?? owner.assistantId} />
            <Field label="Phone number ID" value={call.phoneNumberId ?? owner.phoneNumberId} />
            <Field label="Customer" value={call.customerNumber ?? owner.customerNumber} />
            <Field
              label="Recording"
              value={
                call.recordingUrl ? (
                  <a
                    href={call.recordingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    Open recording
                  </a>
                ) : (
                  "—"
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            {call.transcript
              ? "Final transcript from Vapi's end-of-call report."
              : "The transcript arrives with the end-of-call report. Use Refresh if the webhook was missed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {call.transcript ? (
            <pre className="text-sm whitespace-pre-wrap">{call.transcript}</pre>
          ) : (
            <p className="text-muted-foreground py-6 text-center text-sm">No transcript yet.</p>
          )}
        </CardContent>
      </Card>

      {call.summary ? (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{call.summary}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
