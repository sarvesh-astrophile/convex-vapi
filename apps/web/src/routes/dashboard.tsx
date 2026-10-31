import { api } from "@convex-vapi/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import McpConnections from "@/components/mcp-connections";
import UserMenu from "@/components/user-menu";

export const Route = createFileRoute("/dashboard")({
  component: DashboardContent,
});

function DashboardContent() {
  const privateData = useQuery(api.privateData.get);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">privateData: {privateData?.message}</p>
      </div>
      <UserMenu />
      <McpConnections />
    </div>
  );
}
