import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireWorkspaceMember } from "./lib/workspaceAuth";
import { rateLimiter } from "./rateLimits";

async function getUserId(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  // With Convex Better Auth, `subject` is the Better Auth user id.
  return identity.subject;
}

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const userId = await getUserId(ctx);
  if (!userId) {
    throw new Error("Unauthenticated");
  }
  return userId;
}

async function findCallByCallId(
  ctx: QueryCtx | MutationCtx,
  callId: string,
): Promise<Doc<"calls"> | null> {
  return await ctx.db
    .query("calls")
    .withIndex("by_callId", (q) => q.eq("callId", callId))
    .unique();
}

async function assertCanAccessCall(
  ctx: QueryCtx | MutationCtx,
  call: Doc<"calls">,
): Promise<string> {
  const userId = await requireUserId(ctx);
  if (call.workspaceId) {
    await requireWorkspaceMember(ctx, call.workspaceId);
    return userId;
  }
  if (call.userId !== userId) {
    throw new Error("This call belongs to another user");
  }
  return userId;
}

/**
 * Called by the browser once a call starts. The call sync may have already
 * created the row, so this claims it for the signed-in user instead of
 * blindly inserting a duplicate.
 */
export const register = mutation({
  args: {
    callId: v.string(),
    assistantId: v.optional(v.string()),
    runtime: v.optional(v.union(v.literal("vapi"), v.literal("cloudflare"))),
    workspaceId: v.optional(v.id("workspaces")),
    agentId: v.optional(v.id("agents")),
  },
  handler: async (ctx, args): Promise<Id<"calls">> => {
    const userId = await requireUserId(ctx);
    const existing = await findCallByCallId(ctx, args.callId);
    const now = Date.now();

    let workspaceId = args.workspaceId;
    let agentId = args.agentId;

    if (workspaceId) {
      await requireWorkspaceMember(ctx, workspaceId);
    }
    if (agentId) {
      const agent = await ctx.db.get("agents", agentId);
      if (!agent) {
        throw new Error("Agent not found");
      }
      if (workspaceId && agent.workspaceId !== workspaceId) {
        throw new Error("Agent does not belong to this workspace");
      }
      workspaceId = agent.workspaceId;
      await requireWorkspaceMember(ctx, agent.workspaceId);
    }

    if (existing) {
      if (existing.userId && existing.userId !== userId) {
        throw new Error("This call belongs to another user");
      }
      if (existing.workspaceId && workspaceId && existing.workspaceId !== workspaceId) {
        throw new Error("This call belongs to another workspace");
      }
      await ctx.db.patch("calls", existing._id, {
        userId,
        assistantId: existing.assistantId ?? args.assistantId,
        workspaceId: existing.workspaceId ?? workspaceId,
        agentId: existing.agentId ?? agentId,
        ...(args.runtime ? { runtime: args.runtime } : {}),
        updatedAt: now,
      });
      return existing._id;
    }

    await rateLimiter.limit(ctx, "testCall", {
      key: `${userId}:${workspaceId ?? "personal"}`,
      throws: true,
    });

    return await ctx.db.insert("calls", {
      callId: args.callId,
      userId,
      workspaceId,
      agentId,
      assistantId: args.assistantId,
      runtime: args.runtime,
      type: "webCall",
      status: "in-progress",
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Browser-side "I hung up" write. The end-of-call-report webhook still fills in
 * the transcript, summary, cost, and final ended reason.
 */
export const markEnded = mutation({
  args: { callId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const existing = await findCallByCallId(ctx, args.callId);
    if (!existing) {
      return null;
    }
    await assertCanAccessCall(ctx, existing);

    const now = Date.now();
    await ctx.db.patch("calls", existing._id, {
      status: "ended",
      endedAt: existing.endedAt ?? now,
      updatedAt: now,
    });
    return null;
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

    const turns = await ctx.db
      .query("callTurns")
      .withIndex("by_callId_and_at", (q) => q.eq("callId", args.callId))
      .order("asc")
      .take(500);

    return { call, turns };
  },
});
