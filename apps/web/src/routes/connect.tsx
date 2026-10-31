import { api } from "@convex-vapi/backend/convex/_generated/api";
import { Button } from "@convex-vapi/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@convex-vapi/ui/components/card";
import { Checkbox } from "@convex-vapi/ui/components/checkbox";
import { Input } from "@convex-vapi/ui/components/input";
import { Label } from "@convex-vapi/ui/components/label";
import { createFileRoute } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export const Route = createFileRoute("/connect")({
  validateSearch: (search: Record<string, unknown>) => ({
    request: typeof search.request === "string" ? search.request : undefined,
  }),
  component: ConnectPage,
  head: () => ({
    meta: [{ title: "Connect an agent · Auto Driver Data" }],
  }),
});

function ConnectPage() {
  const { request } = Route.useSearch();
  const [requestId, setRequestId] = useState<string | undefined>(request);
  const [framed, setFramed] = useState(false);

  useEffect(() => {
    setRequestId(request);
  }, [request]);

  useEffect(() => {
    setFramed(window.top !== window.self);
  }, []);

  if (framed) {
    return (
      <main className="mx-auto w-full max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Open this page directly</CardTitle>
            <CardDescription>
              Agent approvals cannot be shown inside another site&apos;s frame.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl p-6">
      <Authenticated>
        <ConsentPanel requestId={requestId} onRequestId={setRequestId} />
      </Authenticated>
      <Unauthenticated>
        <SignedOutPanel />
      </Unauthenticated>
      <AuthLoading>
        <p className="text-muted-foreground text-sm">Loading…</p>
      </AuthLoading>
    </main>
  );
}

function SignedOutPanel() {
  const [showSignIn, setShowSignIn] = useState(true);

  return (
    <div>
      <p className="mb-4 text-muted-foreground text-sm">Sign in to approve the agent connection.</p>
      {showSignIn ? (
        <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} onSuccess={() => undefined} />
      ) : (
        <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} onSuccess={() => undefined} />
      )}
    </div>
  );
}

function ConsentPanel({
  requestId,
  onRequestId,
}: {
  requestId: string | undefined;
  onRequestId: (id: string) => void;
}) {
  if (!requestId) {
    return <FindRequestPanel onRequestId={onRequestId} />;
  }
  return <RequestDecision requestId={requestId} />;
}

function FindRequestPanel({ onRequestId }: { onRequestId: (id: string) => void }) {
  const findRequest = useMutation(api.mcp.findAuthRequest);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect an AI agent</CardTitle>
        <CardDescription>
          Paste the code your agent is showing, or reopen the approval link it gave you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const found = await findRequest({ userCode: code });
              if (!found) {
                setError("No pending request matches that code. Check the code and try again.");
                return;
              }
              onRequestId(found);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not find that request.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="user-code">Agent code</Label>
            <Input
              id="user-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="BCDF-GHJK"
              autoComplete="one-time-code"
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <Button type="submit" disabled={busy || code.trim().length === 0}>
            {busy ? "Looking up…" : "Find request"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RequestDecision({ requestId }: { requestId: string }) {
  const request = useQuery(api.mcp.getAuthRequest, { requestId });
  const authorize = useAction(api.mcp.authorize);
  const [confirmedCode, setConfirmedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);

  if (request === undefined) {
    return <p className="text-muted-foreground text-sm">Loading request…</p>;
  }
  if (request === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Request expired</CardTitle>
          <CardDescription>
            This approval link is no longer valid. Start the connection again from your agent.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isDevice = request.kind === "device";
  const canApprove = !isDevice || (confirmedCode && Boolean(request.userCode));

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      const { redirectUrl } = await authorize({
        requestId,
        approve,
        ...(approve && isDevice && request.userCode ? { userCode: request.userCode } : {}),
      });
      setDone(approve ? "approved" : "denied");
      if (redirectUrl) {
        window.location.assign(redirectUrl);
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not complete the request.");
    } finally {
      setBusy(false);
    }
  };

  if (request.status !== "pending" || done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {done === "denied" || request.status === "denied" ? "Access denied" : "Agent connected"}
          </CardTitle>
          <CardDescription>
            {isDevice || done
              ? "You can close this tab and return to your agent."
              : "Redirecting back to your agent…"}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect {request.serverName}</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">
            {request.clientName ?? "An unnamed agent"}
          </span>{" "}
          <span className="rounded border px-1 py-0.5 text-xs">unverified client name</span> wants
          access to your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <h2 className="mb-2 font-medium text-sm">Permissions requested</h2>
          <ul className="space-y-1 text-sm">
            {request.scopes.map((scope) => (
              <li key={scope.name} className="rounded border p-2">
                <code className="text-xs">{scope.name}</code>
                <p className="text-muted-foreground">{scope.description}</p>
              </li>
            ))}
          </ul>
        </div>

        {isDevice ? (
          <div className="space-y-3 rounded border p-3">
            <p className="text-sm">Confirm the code shown in your agent:</p>
            <p className="font-mono text-2xl tracking-widest">{request.userCode}</p>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={confirmedCode}
                onCheckedChange={(checked) => setConfirmedCode(checked === true)}
              />
              <span>This code matches the one my agent is showing.</span>
            </label>
          </div>
        ) : request.redirectUri ? (
          <p className="text-muted-foreground text-sm">
            You will be returned to{" "}
            <span className="font-medium text-foreground">{new URL(request.redirectUri).host}</span>
            .
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button disabled={busy || !canApprove} onClick={() => void decide(true)}>
            {busy ? "Working…" : "Allow"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>
            Deny
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
