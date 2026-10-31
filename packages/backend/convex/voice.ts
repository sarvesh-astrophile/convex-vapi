import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { sha256Hex } from "./lib/crypto";

/**
 * Exchanges a per-call capability token for the published agent config.
 *
 * The token is bound to one `callId` and expires, so a leaked runtime secret no
 * longer exposes every published agent's system prompt. The token is reusable
 * until it expires: a reconnecting client hits the same call-scoped Durable
 * Object and must be able to reload its config after eviction.
 */
export const consumeCallToken = internalMutation({
  args: {
    callId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const session = await ctx.db
      .query("callSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!session || session.callId !== args.callId) {
      throw new Error("Invalid call token");
    }
    const now = Date.now();
    if (session.expiresAt < now) {
      throw new Error("Call token expired");
    }
    if (!session.usedAt) {
      await ctx.db.patch("callSessions", session._id, { usedAt: now });
    }

    const call = await ctx.db
      .query("calls")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call) {
      throw new Error("Call not found");
    }

    const agent = await ctx.db.get("agents", session.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    const versionId = call.agentVersionId ?? agent.publishedVersionId ?? agent.currentVersionId;
    if (!versionId) {
      throw new Error("Agent has no published configuration");
    }
    const version = await ctx.db.get("agentVersions", versionId);
    if (!version) {
      throw new Error("Agent version not found");
    }

    return {
      agentId: agent._id,
      workspaceId: agent.workspaceId,
      name: agent.name,
      versionId: version._id,
      runtime: "cloudflare" as const,
      config: version.config,
    };
  },
});
