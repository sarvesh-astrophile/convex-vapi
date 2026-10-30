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
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";

import { formatCost, formatDuration, formatTimestamp } from "@/lib/format";

export const Route = createFileRoute("/_auth/calls/$callId")({
  component: CallDetailPage,
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function CallDetailPage() {
  const { callId } = Route.useParams();
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(api.calls.get, isAuthenticated ? { callId } : "skip");

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
          It may belong to another account or the webhook has not arrived yet.
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

  const { call, turns } = result;

  return (
    <div className="container mx-auto grid max-w-4xl gap-6 px-4 py-6">
      <div>
        <Link
          to="/calls"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          <ArrowLeft /> Calls
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{call.summary ?? "Untitled call"}</CardTitle>
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
            <Field label="Assistant" value={call.assistantId ?? "—"} />
          </div>

          {call.recordingUrl ? (
            <a
              href={call.recordingUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit" })}
            >
              <ExternalLink /> Open recording
            </a>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            {turns.length > 0
              ? `${turns.length} turns saved from the end-of-call report.`
              : "No structured turns yet. Vapi sends the transcript with the end-of-call report."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {turns.length > 0 ? (
            <div className="flex flex-col gap-3">
              {turns.map((turn) => (
                <div
                  key={turn._id}
                  className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${
                      turn.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-60">
                      {turn.role === "user" ? "You" : "Agent"}
                    </div>
                    {turn.text}
                  </div>
                </div>
              ))}
            </div>
          ) : call.transcript ? (
            <pre className="text-sm whitespace-pre-wrap">{call.transcript}</pre>
          ) : (
            <p className="text-muted-foreground py-6 text-center text-sm">
              The transcript will appear after Vapi sends the end-of-call report.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
