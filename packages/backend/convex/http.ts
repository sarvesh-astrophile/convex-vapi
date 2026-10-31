import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { hmacSha256Hex, timingSafeEqual } from "./lib/crypto";

const http = httpRouter();

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

http.route({
  path: "/voice/config",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const callId = url.searchParams.get("callId") ?? "";
    const token = request.headers.get("x-voice-token") ?? url.searchParams.get("token") ?? "";
    if (callId.length === 0 || token.length === 0) {
      return new Response("Missing callId or token", { status: 400 });
    }

    try {
      const config = await ctx.runMutation(internal.voice.consumeCallToken, { callId, token });
      return Response.json(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Config lookup failed";
      const status = message.toLowerCase().includes("not found") ? 404 : 401;
      return new Response(message, { status });
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

    const rawBody = await request.text();
    const timestamp = request.headers.get("x-voice-timestamp") ?? "";
    const signature = request.headers.get("x-voice-signature") ?? "";
    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_CLOCK_SKEW_MS) {
      return new Response("Stale or missing timestamp", { status: 401 });
    }

    const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
    if (!timingSafeEqual(signature, expected)) {
      return new Response("Unauthorized", { status: 401 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    if (!isRecord(parsed)) {
      return new Response("Invalid voice payload", { status: 400 });
    }

    const deliveryId = stringField(parsed, "deliveryId");
    const callId = stringField(parsed, "callId");
    const agentId = stringField(parsed, "agentId");
    const workspaceId = stringField(parsed, "workspaceId");
    const events = parseEvents(parsed.events);

    if (!deliveryId || !callId || !events) {
      return new Response("Invalid voice payload", { status: 400 });
    }

    try {
      await ctx.runMutation(internal.voiceWebhook.ingest, {
        deliveryId,
        payload: rawBody,
        callId,
        agentId: agentId ? (agentId as Id<"agents">) : undefined,
        workspaceId: workspaceId ? (workspaceId as Id<"workspaces">) : undefined,
        modelProvider: stringField(parsed, "modelProvider") ?? undefined,
        modelName: stringField(parsed, "modelName") ?? undefined,
        endedReason: stringField(parsed, "endedReason") ?? undefined,
        transcript: stringField(parsed, "transcript") ?? undefined,
        endedAt: numberField(parsed, "endedAt"),
        events,
        usage: parseUsage(parsed.usage),
      });
    } catch (error) {
      console.error("Failed to ingest voice events", error);
      return new Response("Failed to apply voice events", { status: 500 });
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

type IngestEvent = {
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

function parseEvents(value: unknown): IngestEvent[] | null {
  if (!Array.isArray(value)) return null;

  const events: IngestEvent[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const eventId = stringField(item, "eventId");
    const type = stringField(item, "type");
    const seq = numberField(item, "seq");
    const at = numberField(item, "at") ?? 0;
    if (!eventId || !type || seq === undefined) return null;

    const role = item.role === "user" || item.role === "assistant" ? item.role : undefined;
    events.push({
      eventId,
      seq,
      type,
      at,
      ...(role ? { role } : {}),
      ...(stringField(item, "text") ? { text: stringField(item, "text")! } : {}),
      ...(stringField(item, "status") ? { status: stringField(item, "status")! } : {}),
      ...(stringField(item, "reason") ? { reason: stringField(item, "reason")! } : {}),
      ...(stringField(item, "data") ? { data: stringField(item, "data")! } : {}),
    });
  }

  return events.slice(0, 200);
}

function parseUsage(value: unknown):
  | {
      turns?: number;
      sttAudioMs?: number;
      ttsCharacters?: number;
      promptTokens?: number;
      completionTokens?: number;
      llmMs?: number;
      ttsMs?: number;
      firstAudioMs?: number;
    }
  | undefined {
  if (!isRecord(value)) return undefined;
  return {
    turns: numberField(value, "turns"),
    sttAudioMs: numberField(value, "sttAudioMs"),
    ttsCharacters: numberField(value, "ttsCharacters"),
    promptTokens: numberField(value, "promptTokens"),
    completionTokens: numberField(value, "completionTokens"),
    llmMs: numberField(value, "llmMs"),
    ttsMs: numberField(value, "ttsMs"),
    firstAudioMs: numberField(value, "firstAudioMs"),
  };
}
