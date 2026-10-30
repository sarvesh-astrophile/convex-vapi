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
import { useConvexAuth, useQuery } from "convex/react";
import { Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";

import { ENV } from "@/env.public";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { useVapiCall, type ConnectionState, type LiveTurn } from "@/hooks/use-vapi-call";
import { formatCost, formatTimestamp } from "@/lib/format";

export const Route = createFileRoute("/_auth/voice")({
  validateSearch: (search: Record<string, unknown>): { assistant?: string } => {
    if (typeof search.assistant === "string" && search.assistant.length > 0) {
      return { assistant: search.assistant };
    }
    return {};
  },
  component: VoicePage,
});

const STATUS_LABEL: Record<ConnectionState, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  active: "Live",
  ending: "Hanging up…",
  ended: "Call ended",
  error: "Error",
};

function statusDotClass(connection: ConnectionState): string {
  switch (connection) {
    case "active":
      return "bg-emerald-500 animate-pulse";
    case "connecting":
    case "ending":
      return "bg-amber-500 animate-pulse";
    case "error":
      return "bg-red-500";
    case "ended":
      return "bg-zinc-400";
    default:
      return "bg-zinc-500";
  }
}

function TurnBubble({ turn }: { turn: LiveTurn }) {
  const isUser = turn.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-60">
          {isUser ? "You" : "Agent"}
        </div>
        {turn.text}
      </div>
    </div>
  );
}

function VoicePage() {
  const { assistant } = Route.useSearch();
  const assistantId = assistant && assistant.length > 0 ? assistant : ENV.VITE_VAPI_ASSISTANT_ID;
  const { workspace } = useActiveWorkspace();
  const call = useVapiCall(ENV.VITE_VAPI_PUBLIC_KEY, assistantId, workspace?._id);
  const { isAuthenticated } = useConvexAuth();
  const recentCalls = useQuery(
    api.calls.list,
    isAuthenticated ? { limit: 8, workspaceId: workspace?._id } : "skip",
  );

  const status = STATUS_LABEL[call.connection];
  const transcript: Array<LiveTurn & { partial?: boolean }> = [
    ...call.turns,
    ...(call.partial ? [{ ...call.partial, partial: true }] : []),
  ];

  return (
    <div className="container mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Voice agent</CardTitle>
              <CardDescription>
                {assistant
                  ? "Browser microphone call against a published builder agent."
                  : "Browser microphone call powered by Vapi. Transcripts and final reports sync into Convex."}
              </CardDescription>
              {assistant ? (
                <p className="text-muted-foreground mt-1 font-mono text-[11px]">
                  Assistant: {assistant}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
              <span className={`h-2 w-2 rounded-full ${statusDotClass(call.connection)}`} />
              {status}
            </div>
          </CardHeader>

          <CardContent className="grid gap-4">
            {!call.configured ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">Vapi is not configured yet.</p>
                <p className="text-muted-foreground mt-1">
                  Add <code>VITE_VAPI_PUBLIC_KEY</code> and <code>VITE_VAPI_ASSISTANT_ID</code> to{" "}
                  <code>apps/web/.env</code>, then restart the dev server.
                </p>
              </div>
            ) : null}

            {call.error ? (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
                {call.error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {call.isLive ? (
                <Button
                  variant="destructive"
                  onClick={() => void call.stop()}
                  disabled={call.connection === "ending"}
                >
                  {call.connection === "ending" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <PhoneOff />
                  )}
                  End call
                </Button>
              ) : (
                <Button
                  onClick={() => void call.start()}
                  disabled={!call.configured || !call.ready}
                >
                  {!call.ready ? <Loader2 className="animate-spin" /> : <Phone />}
                  {call.connection === "ended" ? "Start another call" : "Start call"}
                </Button>
              )}

              <Button variant="outline" onClick={call.toggleMute} disabled={!call.isLive}>
                {call.muted ? <MicOff /> : <Mic />}
                {call.muted ? "Unmute" : "Mute"}
              </Button>

              {call.callId ? (
                <span className="text-muted-foreground truncate text-xs">Call {call.callId}</span>
              ) : null}
            </div>

            <p className="text-muted-foreground font-mono text-[11px]">
              Assistant: {assistantId || "not set"}
            </p>

            <p className="text-muted-foreground text-xs">
              The browser asks for microphone access. Audio is handled by Vapi; call status and the
              final transcript arrive through a signed webhook.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live transcript</CardTitle>
            <CardDescription>
              Incremental transcripts from the active call. The saved transcript appears once Vapi
              sends the end-of-call report.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex max-h-[420px] min-h-40 flex-col gap-3 overflow-y-auto pr-1">
              {transcript.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  Start a call and say hello to see the transcript here.
                </p>
              ) : (
                transcript.map((turn) => (
                  <div key={turn.id} className={turn.partial ? "opacity-60" : undefined}>
                    <TurnBubble turn={turn} />
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent calls</CardTitle>
            <CardDescription>Live from the calls table in Convex.</CardDescription>
          </div>
          <Link to="/calls" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {recentCalls === undefined ? (
            <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Loader2 className="animate-spin" /> Loading calls…
            </div>
          ) : recentCalls.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">No calls yet.</p>
          ) : (
            <ul className="divide-y">
              {recentCalls.map((recent) => (
                <li key={recent._id}>
                  <Link
                    to="/calls/$callId"
                    params={{ callId: recent.callId }}
                    className="hover:bg-muted/50 block rounded-sm px-1 py-3 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">
                        {recent.summary ?? "Untitled call"}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {recent.status}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                      <span>{formatTimestamp(recent.createdAt)}</span>
                      <span>{formatCost(recent.cost)}</span>
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
