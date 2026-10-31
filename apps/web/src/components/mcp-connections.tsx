import { api } from "@convex-vapi/backend/convex/_generated/api";
import { Button } from "@convex-vapi/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@convex-vapi/ui/components/card";
import { Input } from "@convex-vapi/ui/components/input";
import { Label } from "@convex-vapi/ui/components/label";
import { useAction, useMutation, useQuery } from "convex/react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ENV } from "@/env.public";

export default function McpConnections() {
  const serverUrl = `${ENV.VITE_CONVEX_SITE_URL}/mcp/auto`;
  const connections = useQuery(api.mcp.listConnections);
  const createApiKey = useAction(api.mcp.createApiKey);
  const revokeConnection = useMutation(api.mcp.revokeConnection);

  const [keyName, setKeyName] = useState("CLI key");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const createKey = async () => {
    setBusy(true);
    try {
      const result = await createApiKey({ name: keyName.trim() || "CLI key" });
      setCreatedKey(result.apiKey);
      toast.success("API key created. Copy it now; it is only shown once.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not create the API key.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeConnection({ id });
      toast.success("Connection revoked");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not revoke the connection.");
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected agents (MCP)</CardTitle>
        <CardDescription>
          Let Claude, ChatGPT, Cursor, or Claude Code read the Auto driver demo data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>MCP server URL</Label>
          <div className="flex gap-2">
            <Input readOnly value={serverUrl} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => void copy(serverUrl)}>
              <Copy />
              <span className="sr-only">Copy MCP server URL</span>
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mcp-key-name">Create an API key for CLI agents</Label>
          <div className="flex gap-2">
            <Input
              id="mcp-key-name"
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              placeholder="Laptop CLI"
            />
            <Button disabled={busy} onClick={() => void createKey()}>
              <KeyRound /> {busy ? "Creating…" : "Create key"}
            </Button>
          </div>
          {createdKey ? (
            <div className="space-y-2 rounded border p-3">
              <p className="text-sm">Copy this key now. It will not be shown again.</p>
              <code className="block overflow-x-auto break-all text-xs">{createdKey}</code>
              <Button variant="outline" size="sm" onClick={() => void copy(createdKey)}>
                <Copy /> Copy key
              </Button>
            </div>
          ) : null}
          <pre className="overflow-x-auto rounded border p-3 text-xs">
            {`claude mcp add --transport http auto-driver ${serverUrl} \\\n  --header "Authorization: Bearer <key>"`}
          </pre>
        </div>

        <div className="space-y-2">
          <h3 className="font-medium text-sm">Active connections</h3>
          {connections === undefined ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : connections.length === 0 ? (
            <p className="text-muted-foreground text-sm">No agents connected yet.</p>
          ) : (
            <ul className="space-y-2">
              {connections.map((connection) => (
                <li
                  key={connection.id}
                  className="flex items-start justify-between gap-3 rounded border p-3"
                >
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{connection.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {connection.kind} · {connection.scopes.join(", ") || "no scopes"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Created {new Date(connection.createdAt).toLocaleDateString()}
                      {connection.lastUsedAt
                        ? ` · Last used ${new Date(connection.lastUsedAt).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void revoke(connection.id)}
                  >
                    <Trash2 /> Disconnect
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
