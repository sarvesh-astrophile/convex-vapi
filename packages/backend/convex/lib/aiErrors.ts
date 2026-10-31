import { ConvexError } from "convex/values";

const GATEWAY_DISABLED_MARKERS = [
  "gateway is not enabled",
  "ai gateway",
  "upgrade to a paid plan",
  "aigatewaydisabled",
  "aigatewayunavailable",
  "spendinglimitexceeded",
  "teamsuspended",
];

/**
 * Convex AI Gateway failures are opaque provider errors. Surface the common
 * "not enabled on this team" case with an actionable message and keep the
 * rest short enough to render in a toast.
 */
export function throwAiGatewayError(error: unknown, label: string): never {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (GATEWAY_DISABLED_MARKERS.some((marker) => normalized.includes(marker))) {
    throw new ConvexError({
      code: "AI_GATEWAY_NOT_CONFIGURED",
      message:
        "Convex AI Gateway is not enabled for this team. It requires a paid Convex plan. Enable AI Gateway in the Convex dashboard or upgrade the team, then retry.",
    });
  }

  throw new ConvexError({
    code: "AI_GATEWAY_FAILED",
    message: `${label} failed: ${message.slice(0, 300)}`,
  });
}
