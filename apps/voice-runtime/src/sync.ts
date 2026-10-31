import type { CallUsage, Env } from "./env";

export type RuntimeEvent = {
  eventId: string;
  seq: number;
  type: string;
  at: number;
  role?: "user" | "assistant";
  text?: string;
  status?: string;
  reason?: string;
  data?: string;
};

export type EventBatch = {
  callId: string;
  agentId: string;
  workspaceId: string;
  modelProvider: string;
  modelName: string;
  events: RuntimeEvent[];
  usage?: CallUsage;
  endedReason?: string;
  transcript?: string;
  endedAt?: number;
};

/**
 * Ships a batch of runtime events to Convex.
 *
 * The body is HMAC-signed together with a timestamp, so a captured request
 * cannot be replayed after the skew window. Dedupe still happens on the Convex
 * side by `deliveryId`.
 */
export async function postEvents(env: Env, batch: EventBatch): Promise<void> {
  const timestamp = Date.now().toString();
  const body = JSON.stringify({
    deliveryId: crypto.randomUUID(),
    ...batch,
  });
  const signature = await sign(env.VOICE_SYNC_SECRET, `${timestamp}.${body}`);

  const response = await fetch(new URL("/webhooks/voice", env.CONVEX_SITE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-voice-timestamp": timestamp,
      "x-voice-signature": signature,
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Event sync failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
