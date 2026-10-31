import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { randomToken, sha256Hex } from "./lib/crypto";
import { requireUserId, requireWorkspaceMember } from "./lib/workspaceAuth";
import { rateLimiter } from "./rateLimits";

const CALL_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_CALL_MS = 10 * 60 * 1000;

async function getUserId(ctx: QueryCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity ? identity.subject : null;
}

async function findCallByCallId(ctx: QueryCtx, callId: string): Promise<Doc<"calls"> | null> {
  return await ctx.db
    .query("calls")
    .withIndex("by_callId", (q) => q.eq("callId", callId))
    .unique();
}

/**
 * Mints a call id and a short-lived capability token, and inserts the call row
 * before any audio flows. The runtime reads that row's config with the token,
 * so the browser never has to be trusted with call ownership and the call
 * exists in Convex even if the tab closes immediately.
 */
export const start = mutation({
  args: {
    agentId: v.id("agents"),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args): Promise<{ callId: string; token: string }> => {
    const userId = await requireUserId(ctx);
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    if (agent.status === "archived") {
      throw new Error("This agent has been archived");
    }
    if (args.workspaceId && args.workspaceId !== agent.workspaceId) {
      throw new Error("Agent does not belong to this workspace");
    }
    await requireWorkspaceMember(ctx, agent.workspaceId);

    const versionId = agent.publishedVersionId;
    if (!versionId) {
      throw new Error("Publish this agent before starting a call");
    }

    await rateLimiter.limit(ctx, "testCall", {
      key: `${userId}:${agent.workspaceId}`,
      throws: true,
    });

    const now = Date.now();
    const callId = `cf_${randomToken(16)}`;
    const token = randomToken();
    const tokenHash = await sha256Hex(token);

    await ctx.db.insert("calls", {
      callId,
      userId,
      workspaceId: agent.workspaceId,
      agentId: agent._id,
      agentVersionId: versionId,
      status: "queued",
      lastSeq: 0,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("callSessions", {
      callId,
      tokenHash,
      agentId: agent._id,
      workspaceId: agent.workspaceId,
      userId,
      expiresAt: now + CALL_TOKEN_TTL_MS,
      createdAt: now,
    });

    return { callId, token };
  },
});

export const list = query({
  args: {
    limit: v.optional(v.number()),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) {
      return [];
    }
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 50);

    if (args.workspaceId) {
      await requireWorkspaceMember(ctx, args.workspaceId);
      return await ctx.db
        .query("calls")
        .withIndex("by_workspaceId_and_createdAt", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("calls")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

/** Live calls for a workspace dashboard. Indexed, never a status table scan. */
export const live = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("calls")
      .withIndex("by_workspaceId_and_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "in-progress"),
      )
      .order("desc")
      .take(25);
    return rows;
  },
});

export const get = query({
  args: { callId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) {
      return null;
    }
    const call = await findCallByCallId(ctx, args.callId);
    if (!call) {
      return null;
    }

    if (call.workspaceId) {
      try {
        await requireWorkspaceMember(ctx, call.workspaceId);
      } catch {
        return null;
      }
    } else if (call.userId !== userId) {
      return null;
    }

    // Ordered by `at`, not `seq`, so turns written before the event stream
    // existed still render.
    const turns = await ctx.db
      .query("callTurns")
      .withIndex("by_callId_and_at", (q) => q.eq("callId", args.callId))
      .order("asc")
      .take(500);
    const events = await ctx.db
      .query("callEvents")
      .withIndex("by_callId_and_seq", (q) => q.eq("callId", args.callId))
      .order("asc")
      .take(200);
    const usage = await ctx.db
      .query("callUsage")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .unique();

    return { call, turns, events, usage };
  },
});

/**
 * Metering read for the workspace. Bounded: enough rows for a dashboard, not a
 * billing-grade rollup (that belongs in an aggregate or a denormalized counter).
 */
export const usage = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("callUsage")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .take(500);

    return rows.reduce(
      (total, row) => ({
        calls: total.calls + 1,
        turns: total.turns + row.turns,
        ttsCharacters: total.ttsCharacters + row.ttsCharacters,
        promptTokens: total.promptTokens + row.promptTokens,
        completionTokens: total.completionTokens + row.completionTokens,
        avgFirstAudioMs:
          total.calls === 0
            ? row.firstAudioMs
            : Math.round(
                (total.avgFirstAudioMs * total.calls + row.firstAudioMs) / (total.calls + 1),
              ),
      }),
      {
        calls: 0,
        turns: 0,
        ttsCharacters: 0,
        promptTokens: 0,
        completionTokens: 0,
        avgFirstAudioMs: 0,
      },
    );
  },
});

/**
 * Reaper for calls whose runtime vanished (DO eviction, crash, or a dropped
 * final delivery). The partial transcript already streamed into Convex stays.
 */
export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const now = Date.now();
    const cutoff = now - STALE_CALL_MS;
    let swept = 0;

    for (const status of ["queued", "ringing", "in-progress"] as const) {
      const rows = await ctx.db
        .query("calls")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(50);

      for (const row of rows) {
        if (row.updatedAt >= cutoff) {
          continue;
        }
        await ctx.db.patch("calls", row._id, {
          status: "failed",
          endedReason: row.endedReason ?? "runtime-lost",
          endedAt: row.endedAt ?? cutoff,
          updatedAt: now,
        });
        swept += 1;
      }
    }

    // Expired capability tokens are useless; keep the table bounded.
    const expired = await ctx.db
      .query("callSessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now - 60 * 60 * 1000))
      .take(50);
    for (const session of expired) {
      await ctx.db.delete("callSessions", session._id);
    }

    return swept;
  },
});
