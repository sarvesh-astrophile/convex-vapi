import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/sarvam/")({
  beforeLoad: () => {
    throw redirect({ to: "/sarvam/agents" });
  },
});
