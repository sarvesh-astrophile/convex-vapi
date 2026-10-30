import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

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
  path: "/voice/config",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.VOICE_SYNC_SECRET;
    if (!secret) {
      console.error("VOICE_SYNC_SECRET is not configured on the Convex deployment");
      return new Response("Voice sync secret is not configured", { status: 500 });
    }

    const provided = request.headers.get("x-voice-secret") ?? "";
    if (!timingSafeEqual(provided, secret)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const agentId = new URL(request.url).searchParams.get("agentId");
    if (!agentId) {
      return new Response("Missing agentId", { status: 400 });
    }

    try {
      const config = await ctx.runQuery(internal.voice.getPublishedConfig, {
        agentId: agentId as Id<"agents">,
      });
      return Response.json(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Config lookup failed";
      return new Response(message, { status: 404 });
    }
  }),
});

http.route({
  path: "/webhooks/voice",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.VOICE_SYNC_SECRET;
    if (!secret) {
      console.error("VOICE_SYNC_SECRET is not configured on the Convex deployment");
      return new Response("Voice sync secret is not configured", { status: 500 });
    }

    if (!timingSafeEqual(request.headers.get("x-voice-secret") ?? "", secret)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const rawBody = await request.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    if (!isRecord(parsed)) {
      return new Response("Invalid voice payload", { status: 400 });
    }

    const callId = stringField(parsed, "callId");
    const agentId = stringField(parsed, "agentId");
    const workspaceId = stringField(parsed, "workspaceId");
    const turns = parseVoiceTurns(parsed.turns);

    if (!callId || !agentId || !workspaceId || !turns) {
      return new Response("Invalid voice payload", { status: 400 });
    }

    const eventHash = await sha256Hex(rawBody);
    const payloadForAudit = rawBody.length > 500_000 ? rawBody.slice(0, 500_000) : rawBody;
    const event = await ctx.runMutation(internal.voiceWebhook.recordEvent, {
      eventHash,
      eventType: "cloudflare-end-of-call",
      callId,
      payload: payloadForAudit,
    });

    if (event.duplicate) {
      return new Response("Duplicate delivery ignored", { status: 200 });
    }

    try {
      await ctx.runMutation(internal.voiceWebhook.applyEvent, {
        type: "end-of-call-report",
        callId,
        agentId: agentId as Id<"agents">,
        workspaceId: workspaceId as Id<"workspaces">,
        runtime: "cloudflare",
        sessionId: callId,
        modelProvider: stringField(parsed, "modelProvider") ?? undefined,
        modelName: stringField(parsed, "modelName") ?? undefined,
        status: "ended",
        endedReason: stringField(parsed, "endedReason") ?? "call-ended",
        transcript: stringField(parsed, "transcript") ?? undefined,
        startedAt: numberField(parsed, "startedAt"),
        endedAt: numberField(parsed, "endedAt"),
        turns,
      });
    } catch (error) {
      await ctx.runMutation(internal.voiceWebhook.forgetEvent, { eventHash });
      console.error("Failed to apply Cloudflare voice call", error);
      return new Response("Failed to apply voice call", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }),
});

authComponent.registerRoutes(http, createAuth);

export default http;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function parseVoiceTurns(
  value: unknown,
): Array<{ role: "user" | "assistant"; text: string; at: number }> | null {
  if (!Array.isArray(value)) return null;

  const turns: Array<{ role: "user" | "assistant"; text: string; at: number }> = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const role = item.role === "user" || item.role === "assistant" ? item.role : null;
    const text = typeof item.text === "string" ? item.text : null;
    const at = typeof item.at === "number" && Number.isFinite(item.at) ? item.at : 0;
    if (!role || text === null) return null;
    turns.push({ role, text, at });
  }

  return turns.slice(0, 2_000);
}
