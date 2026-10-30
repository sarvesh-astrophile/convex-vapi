import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

export const recordEvent = internalMutation({
  args: {
    eventHash: v.string(),
    eventType: v.string(),
    callId: v.optional(v.string()),
    payload: v.string(),
  },
  handler: async (ctx, args): Promise<{ duplicate: boolean }> => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_eventHash", (q) => q.eq("eventHash", args.eventHash))
      .unique();

    if (existing) {
      return { duplicate: true };
    }

    await ctx.db.insert("webhookEvents", {
      eventHash: args.eventHash,
      eventType: args.eventType,
      callId: args.callId,
      payload: args.payload,
      receivedAt: Date.now(),
    });

    return { duplicate: false };
  },
});

/** Removes a dedupe marker so the runtime's retry can reprocess a failed delivery. */
export const forgetEvent = internalMutation({
  args: { eventHash: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_eventHash", (q) => q.eq("eventHash", args.eventHash))
      .unique();
    if (existing) {
      await ctx.db.delete("webhookEvents", existing._id);
    }
    return null;
  },
});

export const applyEvent = internalMutation({
  args: {
    type: v.string(),
    callId: v.string(),
    assistantId: v.optional(v.string()),
    agentId: v.optional(v.id("agents")),
    workspaceId: v.optional(v.id("workspaces")),
    runtime: v.optional(v.union(v.literal("vapi"), v.literal("cloudflare"))),
    sessionId: v.optional(v.string()),
    modelProvider: v.optional(v.string()),
    modelName: v.optional(v.string()),
    userId: v.optional(v.string()),
    status: v.optional(v.string()),
    endedReason: v.optional(v.string()),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    cost: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    turns: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        text: v.string(),
        at: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<null> => {
    const now = Date.now();
    const incomingStatus =
      args.status ?? (args.type === "end-of-call-report" ? "ended" : undefined);
    const existing = await ctx.db
      .query("calls")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .unique();

    const linkedAgent = args.agentId
      ? await ctx.db.get("agents", args.agentId)
      : args.assistantId
        ? await ctx.db
            .query("agents")
            .withIndex("by_vapiAssistantId", (q) => q.eq("vapiAssistantId", args.assistantId))
            .unique()
        : null;

    if (!existing) {
      await ctx.db.insert("calls", {
        callId: args.callId,
        userId: args.userId,
        workspaceId: args.workspaceId ?? linkedAgent?.workspaceId,
        agentId: args.agentId ?? linkedAgent?._id,
        assistantId: args.assistantId,
        runtime: args.runtime,
        sessionId: args.sessionId,
        modelProvider: args.modelProvider,
        modelName: args.modelName,
        type: "webCall",
        status: incomingStatus ?? "unknown",
        endedReason: args.endedReason,
        transcript: args.transcript,
        summary: args.summary,
        recordingUrl: args.recordingUrl,
        cost: args.cost,
        startedAt: args.startedAt,
        endedAt: args.endedAt ?? (incomingStatus === "ended" ? now : undefined),
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const patch: Partial<Doc<"calls">> = { updatedAt: now };

      if (linkedAgent) {
        patch.workspaceId = existing.workspaceId ?? linkedAgent.workspaceId;
        patch.agentId = existing.agentId ?? linkedAgent._id;
      }
      if (args.agentId && !existing.agentId) {
        patch.agentId = args.agentId;
      }
      if (args.workspaceId && !existing.workspaceId) {
        patch.workspaceId = args.workspaceId;
      }
      if (args.runtime && !existing.runtime) {
        patch.runtime = args.runtime;
      }
      if (args.sessionId && !existing.sessionId) {
        patch.sessionId = args.sessionId;
      }
      if (args.modelProvider && !existing.modelProvider) {
        patch.modelProvider = args.modelProvider;
      }
      if (args.modelName && !existing.modelName) {
        patch.modelName = args.modelName;
      }

      // A late, out-of-order status event must never move an ended call back
      // into an active state.
      if (incomingStatus && !(existing.status === "ended" && incomingStatus !== "ended")) {
        patch.status = incomingStatus;
        if (incomingStatus === "ended") {
          patch.endedAt = args.endedAt ?? existing.endedAt ?? now;
        }
      }

      if (args.userId && !existing.userId) {
        patch.userId = args.userId;
      }
      if (args.assistantId && !existing.assistantId) {
        patch.assistantId = args.assistantId;
      }
      if (args.endedReason) {
        patch.endedReason = args.endedReason;
      }
      if (args.transcript) {
        patch.transcript = args.transcript;
      }
      if (args.summary) {
        patch.summary = args.summary;
      }
      if (args.recordingUrl) {
        patch.recordingUrl = args.recordingUrl;
      }
      if (args.cost !== undefined) {
        patch.cost = args.cost;
      }
      if (args.startedAt !== undefined && existing.startedAt === undefined) {
        patch.startedAt = args.startedAt;
      }
      if (args.endedAt !== undefined) {
        patch.endedAt = args.endedAt;
      }

      await ctx.db.patch("calls", existing._id, patch);
    }

    for (const [index, turn] of args.turns.entries()) {
      const key = `${args.callId}:${index}`;
      const alreadyStored = await ctx.db
        .query("callTurns")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (alreadyStored) {
        continue;
      }

      await ctx.db.insert("callTurns", {
        callId: args.callId,
        role: turn.role,
        text: turn.text,
        at: turn.at > 0 ? turn.at : now + index,
        key,
      });
    }

    return null;
  },
});
