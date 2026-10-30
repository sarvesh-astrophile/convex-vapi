import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { agentConfigValidator, type AgentConfig } from "./lib/agentConfig";
import { requireWorkspaceMember } from "./lib/workspaceAuth";
import { rateLimiter } from "./rateLimits";
import { createVapiAssistant, updateVapiAssistant, type VapiAssistantPayload } from "./vapi/client";

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Agent name is required");
  }
  if (trimmed.length > 80) {
    throw new Error("Agent name must be 80 characters or fewer");
  }
  return trimmed;
}

function normalizeConfig(config: AgentConfig): AgentConfig {
  const model = {
    provider: config.model.provider.trim(),
    model: config.model.model.trim(),
    temperature: Math.min(Math.max(config.model.temperature, 0), 2),
    maxTokens: Math.min(Math.max(Math.round(config.model.maxTokens), 32), 4096),
  };
  const voice = {
    provider: config.voice.provider.trim(),
    voiceId: config.voice.voiceId.trim(),
  };
  const transcriber = {
    provider: config.transcriber.provider.trim(),
    model: config.transcriber.model.trim(),
    language: config.transcriber.language.trim(),
  };

  if (!model.provider || !model.model || !voice.provider || !voice.voiceId) {
    throw new Error("Model provider, model, voice provider, and voice ID are required");
  }
  if (!transcriber.provider || !transcriber.model || !transcriber.language) {
    throw new Error("Transcriber provider, model, and language are required");
  }

  return {
    firstMessage: config.firstMessage.trim(),
    firstMessageMode: config.firstMessageMode ?? "assistant-speaks-first",
    systemPrompt: config.systemPrompt.trim(),
    model,
    voice,
    transcriber,
  };
}

function buildVapiPayload(
  name: string,
  config: AgentConfig,
  webhookUrl: string,
  webhookSecret: string,
): VapiAssistantPayload {
  return {
    name,
    firstMessage: config.firstMessage,
    firstMessageMode: config.firstMessageMode ?? "assistant-speaks-first",
    model: {
      provider: config.model.provider,
      model: config.model.model,
      temperature: config.model.temperature,
      maxTokens: config.model.maxTokens,
      messages: [{ role: "system", content: config.systemPrompt }],
    },
    voice: {
      provider: config.voice.provider,
      voiceId: config.voice.voiceId,
    },
    transcriber: {
      provider: config.transcriber.provider,
      model: config.transcriber.model,
      language: config.transcriber.language,
    },
    server: {
      url: webhookUrl,
      secret: webhookSecret,
    },
    serverMessages: ["status-update", "end-of-call-report"],
  };
}

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    config: agentConfigValidator,
  },
  handler: async (ctx, args): Promise<Id<"agents">> => {
    const auth = await requireWorkspaceMember(ctx, args.workspaceId);
    const now = Date.now();
    const name = normalizeName(args.name);
    const config = normalizeConfig(args.config);

    const agentId = await ctx.db.insert("agents", {
      workspaceId: args.workspaceId,
      name,
      description: args.description?.trim() || undefined,
      status: "draft",
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });

    const versionId = await ctx.db.insert("agentVersions", {
      agentId,
      workspaceId: args.workspaceId,
      version: 1,
      config,
      createdBy: auth.userId,
      createdAt: now,
    });

    await ctx.db.patch("agents", agentId, {
      currentVersionId: versionId,
      updatedAt: now,
    });

    return agentId;
  },
});

export const save = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    config: agentConfigValidator,
  },
  handler: async (ctx, args): Promise<{ versionId: Id<"agentVersions"> }> => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    if (agent.status === "archived") {
      throw new Error("Archived agents cannot be edited");
    }

    const auth = await requireWorkspaceMember(ctx, agent.workspaceId);
    const latest = await ctx.db
      .query("agentVersions")
      .withIndex("by_agentId_and_version", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .first();
    const nextVersion = (latest?.version ?? 0) + 1;
    const now = Date.now();
    const config = normalizeConfig(args.config);

    const versionId = await ctx.db.insert("agentVersions", {
      agentId: agent._id,
      workspaceId: agent.workspaceId,
      version: nextVersion,
      config,
      createdBy: auth.userId,
      createdAt: now,
    });

    await ctx.db.patch("agents", agent._id, {
      name: args.name === undefined ? agent.name : normalizeName(args.name),
      description:
        args.description === undefined ? agent.description : args.description.trim() || undefined,
      currentVersionId: versionId,
      updatedAt: now,
    });

    return { versionId };
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await ctx.db
      .query("agents")
      .withIndex("by_workspaceId_and_updatedAt", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(50);
  },
});

export const get = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) {
      return null;
    }
    await requireWorkspaceMember(ctx, agent.workspaceId);

    const currentVersion = agent.currentVersionId
      ? await ctx.db.get("agentVersions", agent.currentVersionId)
      : null;
    const versions = await ctx.db
      .query("agentVersions")
      .withIndex("by_agentId_and_version", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .take(20);

    return { agent, currentVersion, versions };
  },
});

export const archive = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args): Promise<null> => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    await requireWorkspaceMember(ctx, agent.workspaceId);
    await ctx.db.patch("agents", agent._id, {
      status: "archived",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const getForPublish = internalQuery({
  args: { agentId: v.id("agents"), userId: v.string() },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspaceId_and_userId", (q) =>
        q.eq("workspaceId", agent.workspaceId).eq("userId", args.userId),
      )
      .unique();
    if (!member) {
      throw new Error("You are not a member of this workspace");
    }

    const version = agent.currentVersionId
      ? await ctx.db.get("agentVersions", agent.currentVersionId)
      : null;
    if (!version) {
      throw new Error("Agent has no configuration to publish");
    }

    const siteUrl = process.env.CONVEX_SITE_URL;
    const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
    if (!siteUrl) {
      throw new Error("CONVEX_SITE_URL is not configured");
    }
    if (!webhookSecret) {
      throw new Error("VAPI_WEBHOOK_SECRET is not configured");
    }

    return {
      agentId: agent._id,
      workspaceId: agent.workspaceId,
      name: agent.name,
      vapiAssistantId: agent.vapiAssistantId,
      versionId: version._id,
      config: version.config,
      webhookUrl: `${siteUrl.replace(/\/$/, "")}/webhooks/vapi`,
      webhookSecret,
    };
  },
});

export const markPublished = internalMutation({
  args: {
    agentId: v.id("agents"),
    versionId: v.id("agentVersions"),
    vapiAssistantId: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    const now = Date.now();

    await ctx.db.patch("agents", args.agentId, {
      status: "published",
      vapiAssistantId: args.vapiAssistantId,
      publishedVersionId: args.versionId,
      updatedAt: now,
    });

    await ctx.db.patch("agentVersions", args.versionId, {
      vapiAssistantId: args.vapiAssistantId,
      publishedAt: now,
    });

    return null;
  },
});

export const publish = action({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args): Promise<{ vapiAssistantId: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const data = await ctx.runQuery(internal.agents.getForPublish, {
      agentId: args.agentId,
      userId: identity.subject,
    });

    await rateLimiter.limit(ctx, "publishAgent", {
      key: `${data.workspaceId}:${args.agentId}`,
      throws: true,
    });

    const apiKey = process.env.VAPI_API_KEY;
    if (!apiKey) {
      throw new Error("VAPI_API_KEY is not configured on the Convex deployment");
    }

    const payload = buildVapiPayload(data.name, data.config, data.webhookUrl, data.webhookSecret);
    const assistant = data.vapiAssistantId
      ? await updateVapiAssistant(apiKey, data.vapiAssistantId, payload)
      : await createVapiAssistant(apiKey, payload);

    await ctx.runMutation(internal.agents.markPublished, {
      agentId: args.agentId,
      versionId: data.versionId,
      vapiAssistantId: assistant.id,
    });

    return { vapiAssistantId: assistant.id };
  },
});
