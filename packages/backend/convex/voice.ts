import { v } from "convex/values";

import { internalQuery } from "./_generated/server";

/**
 * Config lookup for the Cloudflare voice runtime. The Durable Object requests
 * this at call start and caches the result in memory for the call.
 */
export const getPublishedConfig = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    const versionId = agent.publishedVersionId ?? agent.currentVersionId;
    if (!versionId) {
      throw new Error("Agent has no configuration");
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
      runtime: agent.publishedRuntime ?? "cloudflare",
      config: version.config,
    };
  },
});
