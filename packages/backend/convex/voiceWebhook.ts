import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { nextCallStatus } from "./lib/callStatus";

const MAX_EVENTS_PER_DELIVERY = 200;
const MAX_PAYLOAD_BYTES = 500_000;

const eventValidator = v.object({
  eventId: v.string(),
  seq: v.number(),
  type: v.string(),
  at: v.number(),
  role: v.optional(v.union(v.literal("user"), v.literal("assistant"))),
  text: v.optional(v.string()),
  status: v.optional(v.string()),
  reason: v.optional(v.string()),
  data: v.optional(v.string()),
});

const usageValidator = v.object({
  turns: v.optional(v.number()),
  sttAudioMs: v.optional(v.number()),
  ttsCharacters: v.optional(v.number()),
  promptTokens: v.optional(v.number()),
  completionTokens: v.optional(v.number()),
  llmMs: v.optional(v.number()),
  ttsMs: v.optional(v.number()),
  firstAudioMs: v.optional(v.number()),
});

/**
 * Single transactional ingest for a batch of runtime events.
 *
 * Invariants:
 * - A delivery is idempotent by `deliveryId` (transport-level dedupe).
 * - Events are applied in `seq` order and anything at or below `lastSeq` is
 *   skipped, so a retried or overlapping batch cannot duplicate turns.
 * - A terminal call never regresses to an active status.
 * - Sparse updates never clear richer data (patch only with defined fields).
 */
export const ingest = internalMutation({
  args: {
    deliveryId: v.string(),
    payload: v.string(),
    callId: v.string(),
    agentId: v.optional(v.id("agents")),
    workspaceId: v.optional(v.id("workspaces")),
    modelProvider: v.optional(v.string()),
    modelName: v.optional(v.string()),
    endedReason: v.optional(v.string()),
    transcript: v.optional(v.string()),
    endedAt: v.optional(v.number()),
    events: v.array(eventValidator),
    usage: v.optional(usageValidator),
  },
  handler: async (ctx, args): Promise<{ duplicate: boolean; applied: number }> => {
    const alreadyDelivered = await ctx.db
      .query("webhookEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.deliveryId))
      .unique();

    if (alreadyDelivered) {
      return { duplicate: true, applied: 0 };
    }

    await ctx.db.insert("webhookEvents", {
      eventId: args.deliveryId,
      eventType: "voice-events",
      callId: args.callId,
      payload:
        args.payload.length > MAX_PAYLOAD_BYTES
          ? args.payload.slice(0, MAX_PAYLOAD_BYTES)
          : args.payload,
      receivedAt: Date.now(),
    });

    const now = Date.now();
    const existing = await ctx.db
      .query("calls")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .unique();

    let callId = existing?._id;
    if (!existing) {
      callId = await ctx.db.insert("calls", {
        callId: args.callId,
        workspaceId: args.workspaceId,
        agentId: args.agentId,
        status: "queued",
        lastSeq: 0,
        modelProvider: args.modelProvider,
        modelName: args.modelName,
        createdAt: now,
        updatedAt: now,
      });
    }

    const call = existing ?? (await ctx.db.get("calls", callId!));
    if (!call) {
      throw new Error("Call row disappeared during ingest");
    }

    let lastSeq = call.lastSeq ?? 0;
    let status: string = call.status;
    const patch: Partial<Doc<"calls">> = { updatedAt: now };

    if (args.workspaceId && !call.workspaceId) {
      patch.workspaceId = args.workspaceId;
    }
    if (args.agentId && !call.agentId) {
      patch.agentId = args.agentId;
    }
    if (args.modelProvider) {
      patch.modelProvider = args.modelProvider;
    }
    if (args.modelName) {
      patch.modelName = args.modelName;
    }
    if (args.transcript) {
      patch.transcript = args.transcript;
    }
    if (args.endedReason) {
      patch.endedReason = args.endedReason;
    }

    const events = [...args.events]
      .sort((left, right) => left.seq - right.seq)
      .slice(0, MAX_EVENTS_PER_DELIVERY);
    let applied = 0;

    for (const event of events) {
      if (event.seq <= lastSeq) {
        continue;
      }
      lastSeq = event.seq;
      applied += 1;
      const at = event.at > 0 ? event.at : now;

      switch (event.type) {
        case "call.started": {
          const next = nextCallStatus(status, "in-progress");
          if (next) status = next;
          if (patch.startedAt === undefined && call.startedAt === undefined) {
            patch.startedAt = at;
          }
          break;
        }
        case "call.status": {
          const next = nextCallStatus(status, event.status ?? "");
          if (next) status = next;
          await ctx.db.insert("callEvents", {
            callId: args.callId,
            workspaceId: args.workspaceId ?? call.workspaceId,
            seq: event.seq,
            kind: event.type,
            at,
            reason: event.reason,
            text: event.text,
            data: event.data,
          });
          break;
        }
        case "call.ended": {
          const next = nextCallStatus(status, "ended");
          if (next) status = next;
          patch.endedAt = args.endedAt ?? at;
          break;
        }
        case "call.failed": {
          const next = nextCallStatus(status, "failed");
          if (next) status = next;
          patch.endedAt = args.endedAt ?? at;
          await ctx.db.insert("callEvents", {
            callId: args.callId,
            workspaceId: args.workspaceId ?? call.workspaceId,
            seq: event.seq,
            kind: event.type,
            at,
            reason: event.reason,
            text: event.text,
            data: event.data,
          });
          break;
        }
        case "turn.appended": {
          if (!event.role || !event.text) {
            break;
          }
          const key = `${args.callId}:${event.seq}`;
          const stored = await ctx.db
            .query("callTurns")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique();
          if (!stored) {
            await ctx.db.insert("callTurns", {
              callId: args.callId,
              seq: event.seq,
              role: event.role,
              text: event.text,
              at,
              key,
            });
          }
          break;
        }
        default: {
          await ctx.db.insert("callEvents", {
            callId: args.callId,
            workspaceId: args.workspaceId ?? call.workspaceId,
            seq: event.seq,
            kind: event.type,
            at,
            reason: event.reason,
            text: event.text,
            data: event.data,
          });
        }
      }
    }

    if (status !== call.status) {
      patch.status = status as Doc<"calls">["status"];
    }
    patch.lastSeq = lastSeq;
    await ctx.db.patch("calls", call._id, patch);

    const workspaceId = patch.workspaceId ?? call.workspaceId;
    if (args.usage && workspaceId) {
      const usage = await ctx.db
        .query("callUsage")
        .withIndex("by_callId", (q) => q.eq("callId", args.callId))
        .unique();
      const next = {
        turns: Math.max(0, Math.round(args.usage.turns ?? 0)),
        sttAudioMs: Math.max(0, Math.round(args.usage.sttAudioMs ?? 0)),
        ttsCharacters: Math.max(0, Math.round(args.usage.ttsCharacters ?? 0)),
        promptTokens: Math.max(0, Math.round(args.usage.promptTokens ?? 0)),
        completionTokens: Math.max(0, Math.round(args.usage.completionTokens ?? 0)),
        llmMs: Math.max(0, Math.round(args.usage.llmMs ?? 0)),
        ttsMs: Math.max(0, Math.round(args.usage.ttsMs ?? 0)),
        firstAudioMs: Math.max(0, Math.round(args.usage.firstAudioMs ?? 0)),
      };

      if (usage) {
        await ctx.db.patch("callUsage", usage._id, next);
      } else {
        await ctx.db.insert("callUsage", {
          callId: args.callId,
          workspaceId,
          ...next,
        });
      }
    }

    return { duplicate: false, applied };
  },
});
