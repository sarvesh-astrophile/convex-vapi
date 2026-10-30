import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { parseVapiWebhook } from "./lib/vapiWebhook";

const http = httpRouter();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

http.route({
  path: "/webhooks/vapi",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.VAPI_WEBHOOK_SECRET;
    if (!secret) {
      console.error("VAPI_WEBHOOK_SECRET is not configured on the Convex deployment");
      return new Response("Webhook secret is not configured", { status: 500 });
    }

    const providedSecret = request.headers.get("x-vapi-secret");
    if (!providedSecret) {
      return new Response("Missing X-Vapi-Secret header", { status: 401 });
    }
    if (!timingSafeEqual(providedSecret, secret)) {
      return new Response("Invalid webhook secret", { status: 401 });
    }

    const rawBody = await request.text();
    const parsed = parseVapiWebhook(rawBody);
    if (!parsed) {
      return new Response("Invalid Vapi payload", { status: 400 });
    }

    const eventHash = await sha256Hex(rawBody);
    // Convex documents are capped at 1 MB. Audit payloads are truncated for
    // unusually large reports; the hash above still covers the full body.
    const payloadForAudit = rawBody.length > 500_000 ? rawBody.slice(0, 500_000) : rawBody;
    const event = await ctx.runMutation(internal.vapiWebhook.recordEvent, {
      eventHash,
      eventType: parsed.type,
      callId: parsed.callId,
      payload: payloadForAudit,
    });

    if (event.duplicate) {
      return new Response("Duplicate delivery ignored", { status: 200 });
    }

    const isCallEvent = parsed.type === "status-update" || parsed.type === "end-of-call-report";

    if (!isCallEvent || !parsed.callId) {
      return new Response("Event recorded", { status: 200 });
    }

    try {
      await ctx.runMutation(internal.vapiWebhook.applyEvent, {
        type: parsed.type,
        callId: parsed.callId,
        assistantId: parsed.assistantId,
        userId: parsed.userId,
        status: parsed.status,
        endedReason: parsed.endedReason,
        transcript: parsed.transcript,
        summary: parsed.summary,
        recordingUrl: parsed.recordingUrl,
        cost: parsed.cost,
        startedAt: parsed.startedAt,
        endedAt: parsed.endedAt,
        turns: parsed.turns,
      });
    } catch (error) {
      // Do not leave a dedupe marker behind for a delivery that failed to
      // apply, otherwise Vapi's retry would be silently dropped.
      await ctx.runMutation(internal.vapiWebhook.forgetEvent, { eventHash });
      console.error("Failed to apply Vapi webhook", error);
      return new Response("Failed to apply webhook", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }),
});

authComponent.registerRoutes(http, createAuth);

export default http;
