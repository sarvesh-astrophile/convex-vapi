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
import { Loader2, Phone } from "lucide-react";

import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { formatDuration, formatTimestamp } from "@/lib/format";

export const Route = createFileRoute("/sarvam/calls/")({
  component: CallsPage,
});

function CallsPage() {
  const { isAuthenticated } = useConvexAuth();
  const { workspace } = useActiveWorkspace();
  const calls = useQuery(
    api.calls.list,
    isAuthenticated ? { limit: 50, workspaceId: workspace?._id } : "skip",
  );

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Call history</CardTitle>
            <CardDescription>
              Every voice call belonging to your account, newest first.
            </CardDescription>
          </div>
          <Link to="/sarvam/voice" className={buttonVariants({ size: "sm" })}>
            <Phone /> New call
          </Link>
        </CardHeader>
        <CardContent>
          {calls === undefined ? (
            <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
              <Loader2 className="animate-spin" /> Loading calls…
            </div>
          ) : calls.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium">No calls yet</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Start a browser call and it will appear here.
              </p>
              <Link
                to="/sarvam/voice"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open the voice agent
              </Link>
            </div>
          ) : (
            <ul className="divide-y">
              {calls.map((call) => (
                <li key={call._id}>
                  <Link
                    to="/sarvam/calls/$callId"
                    params={{ callId: call.callId }}
                    className="hover:bg-muted/50 grid gap-2 rounded-sm px-2 py-4 transition-colors sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {call.summary ?? "Untitled call"}
                      </p>
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        {formatTimestamp(call.createdAt)} ·{" "}
                        {formatDuration(call.startedAt, call.endedAt)}
                      </p>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-3 text-xs sm:justify-end">
                      <span className="rounded-full border px-2 py-0.5">{call.status}</span>
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
