import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/sarvam/")({
  beforeLoad: () => {
    throw redirect({ to: "/sarvam/agents" });
  },
});
