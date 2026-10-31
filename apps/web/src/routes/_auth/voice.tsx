import { api } from "@convex-vapi/backend/convex/_generated/api";
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
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { Loader2, Phone, PhoneCall } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ENV } from "@/env.public";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { errorMessage } from "@/lib/errors";
import { formatCost, formatDuration, formatTimestamp } from "@/lib/format";

export const Route = createFileRoute("/_auth/voice")({
  component: VapiVoicePage,
});

function VapiVoicePage() {
  const { isAuthenticated } = useConvexAuth();
  const { workspace, isLoading } = useActiveWorkspace();
  const navigate = useNavigate();
  const startCall = useAction(api.vapi.start);
  const listAssistants = useAction(api.vapi.listAssistants);
  const listAssistantsRef = useRef(listAssistants);

  const [assistantId, setAssistantId] = useState(ENV.VITE_VAPI_ASSISTANT_ID);
  const [phoneNumberId, setPhoneNumberId] = useState(ENV.VITE_VAPI_PHONE_NUMBER_ID);
  const [customerNumber, setCustomerNumber] = useState("");
  const [isCalling, setIsCalling] = useState(false);
  const [assistants, setAssistants] = useState<Array<{ id: string; name: string }>>([]);
  const [assistantsState, setAssistantsState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );

  const workspaceId = workspace?._id;

  useEffect(() => {
    listAssistantsRef.current = listAssistants;
  }, [listAssistants]);

  useEffect(() => {
    if (!isAuthenticated || !workspaceId) {
      return;
    }

    let cancelled = false;
    setAssistantsState("loading");
    void listAssistantsRef
      .current({ workspaceId })
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setAssistants(rows);
        setAssistantsState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setAssistantsState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, workspaceId]);

  const recentCalls = useQuery(
    api.vapi.list,
    isAuthenticated && workspace ? { workspaceId: workspace._id, limit: 8 } : "skip",
  );
  const stats = useQuery(
    api.vapi.stats,
    isAuthenticated && workspace ? { workspaceId: workspace._id } : "skip",
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) {
      return;
    }

    setIsCalling(true);
    try {
      const result = await startCall({
        workspaceId: workspace._id,
        assistantId,
        phoneNumberId,
        customerNumber,
      });
      toast.success(`Call ${result.status}`);
      await navigate({ to: "/calls/$callId", params: { callId: result.callId } });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsCalling(false);
    }
  }

  if (isLoading || !workspace) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm">
        <Loader2 className="animate-spin" />
        {workspace === null ? "Setting up your workspace…" : "Loading workspace…"}
      </div>
    );
  }

  return (
    <div className="container mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PhoneCall /> Place a Vapi call
            </CardTitle>
            <CardDescription>
              Starts an outbound phone call through Vapi. Choose any assistant from your Vapi
              account; status, transcript, summary, and cost land back in Convex through the Vapi
              webhook.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
              <div className="grid gap-2">
                <Label htmlFor="assistantId">Assistant</Label>
                <Input
                  id="assistantId"
                  value={assistantId}
                  onChange={(event) => setAssistantId(event.target.value)}
                  placeholder="assistant_..."
                  autoComplete="off"
                  list="vapi-assistant-options"
                  required
                />
                <datalist id="vapi-assistant-options">
                  {assistants.map((assistant) => (
                    <option key={assistant.id} value={assistant.id}>
                      {assistant.name}
                    </option>
                  ))}
                </datalist>
                <p className="text-muted-foreground text-xs">
                  {assistantsState === "loading"
                    ? "Loading assistants from Vapi…"
                    : assistantsState === "error"
                      ? "Could not load assistants from Vapi. Enter an assistant ID manually."
                      : assistants.length > 0
                        ? `${assistants.length} assistants available. Pick one or paste an ID.`
                        : "Enter an assistant ID, or add assistants in the Vapi dashboard."}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phoneNumberId">Phone number ID</Label>
                <Input
                  id="phoneNumberId"
                  value={phoneNumberId}
                  onChange={(event) => setPhoneNumberId(event.target.value)}
                  placeholder="phone-number-id from Vapi"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="customerNumber">Customer number</Label>
                <Input
                  id="customerNumber"
                  value={customerNumber}
                  onChange={(event) => setCustomerNumber(event.target.value)}
                  placeholder="+14155552671"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                />
                <p className="text-muted-foreground text-xs">
                  E.164 format. Vapi dials this number and bills the call to your Vapi account.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={isCalling}>
                  {isCalling ? <Loader2 className="animate-spin" /> : <Phone />}
                  {isCalling ? "Placing call…" : "Place call"}
                </Button>
                <span className="text-muted-foreground text-xs">
                  Assistant and phone number IDs are managed in the Vapi dashboard.
                </span>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How the sync works</CardTitle>
            <CardDescription>
              The call is recorded the moment Vapi accepts it, before the first webhook arrives.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-2 text-sm">
            <p>
              Point the Vapi assistant&apos;s server URL at{" "}
              <code className="font-mono text-xs">{ENV.VITE_CONVEX_SITE_URL}/webhooks/vapi</code>{" "}
              and set its server secret to{" "}
              <code className="font-mono text-xs">VAPI_WEBHOOK_SECRET</code>.
            </p>
            <p>
              The component verifies the secret, deduplicates deliveries, and patches the call as it
              moves from queued to ringing, in progress, and ended.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid h-fit gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Workspace calls</CardTitle>
            <CardDescription>
              {stats
                ? `${stats.callCount} calls · ${stats.liveCount} live · ${stats.endedCount} ended`
                : "Loading call stats…"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentCalls === undefined ? (
              <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                <Loader2 className="animate-spin" /> Loading calls…
              </div>
            ) : recentCalls.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">No Vapi calls yet.</p>
            ) : (
              <ul className="divide-y">
                {recentCalls.map(({ call, owner }) => (
                  <li key={call.callId}>
                    <Link
                      to="/calls/$callId"
                      params={{ callId: call.callId }}
                      className="hover:bg-muted/50 block rounded-sm px-1 py-3 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">
                          {call.summary ?? owner.customerNumber}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {call.status}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                        <span>{formatTimestamp(call.startedAt ?? call.createdAt)}</span>
                        <span>
                          {formatDuration(call.startedAt, call.endedAt)} · {formatCost(call.cost)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Link to="/calls" className={buttonVariants({ variant: "outline", size: "sm" })}>
                View all calls
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
