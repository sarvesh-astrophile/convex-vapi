import { v } from "convex/values";

/**
 * Call lifecycle. `unknown` only exists to tolerate rows written by the old
 * Vapi sync; new rows always start at `queued`.
 *
 * A call row is the aggregate root: every turn, event, usage sample and tool
 * invocation points back at `callId`.
 */
export const CALL_STATUSES = [
  "queued",
  "ringing",
  "in-progress",
  "ended",
  "failed",
  "unknown",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export const callStatusValidator = v.union(
  v.literal("queued"),
  v.literal("ringing"),
  v.literal("in-progress"),
  v.literal("ended"),
  v.literal("failed"),
  v.literal("unknown"),
);

export function isCallStatus(value: string): value is CallStatus {
  return (CALL_STATUSES as readonly string[]).includes(value);
}

/**
 * Returns the status to persist, or null when the incoming event must not
 * change it. A terminal call never moves back into an active state, so a late
 * or out-of-order delivery cannot resurrect a finished call.
 */
export function nextCallStatus(current: string, incoming: string): CallStatus | null {
  if (!isCallStatus(incoming)) {
    return null;
  }
  if (current === "ended" || current === "failed") {
    return null;
  }
  return incoming;
}
