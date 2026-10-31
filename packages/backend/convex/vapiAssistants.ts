import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
  DEFAULT_VAPI_ASSISTANT_CONFIG,
  normalizeVapiAssistantConfig,
  normalizeVapiAssistantName,
  vapiAssistantConfigValidator,
  type VapiAssistantConfig,
} from "./lib/vapiAssistantConfig";
import { requireWorkspaceMember } from "./lib/workspaceAuth";
import { rateLimiter } from "./rateLimits";

const VAPI_API_BASE = "https://api.vapi.ai";

type PublishData = {
  assistantId: Id<"vapiAssistants">;
  workspaceId: Id<"workspaces">;
  name: string;
  config: VapiAssistantConfig;
  vapiAssistantId: string | null;
};

function requireVapiApiKey(): string {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    throw new ConvexError({
      code: "VAPI_NOT_CONFIGURED",
      message: "VAPI_API_KEY is not configured on the Convex deployment.",
    });
  }
  return apiKey;
}

/**
 * Vapi's assistant payload. `serverUrl` + `server.secret` are the fields the
 * `convex-vapi` component verifies (`X-Vapi-Secret`) before storing a call.
 */
function buildVapiPayload(name: string, config: VapiAssistantConfig) {
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  const webhookUrl = `${env.CONVEX_SITE_URL}/webhooks/vapi`;

  return {
    name,
    firstMessage: config.firstMessage,
    firstMessageMode: config.firstMessageMode,
    model: {
      provider: config.model.provider,
      model: config.model.model,
      temperature: config.model.temperature,
      maxTokens: config.model.maxTokens,
      messages: [{ role: "system" as const, content: config.systemPrompt }],
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
    // `/calls` renders `call.analysis.summary`; Vapi disables it by default.
    analysisPlan: {
      summaryPlan: { enabled: true },
    },
    ...(config.endCallMessage ? { endCallMessage: config.endCallMessage } : {}),
    ...(config.maxDurationSeconds !== undefined
      ? { maxDurationSeconds: config.maxDurationSeconds }
      : {}),
    ...(config.silenceTimeoutSeconds !== undefined
      ? { silenceTimeoutSeconds: config.silenceTimeoutSeconds }
      : {}),
    ...(webhookSecret
      ? {
          serverUrl: webhookUrl,
          server: { url: webhookUrl, secret: webhookSecret },
        }
      : {}),
  };
}

function assistantIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.id === "string") {
    return record.id;
  }
  const nested = record.assistant;
  if (typeof nested === "object" && nested !== null) {
    const id = (nested as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("vapiAssistants")
      .withIndex("by_workspaceId_and_updatedAt", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(50);

    // Lists do not need the full prompt/model config; keep the payload small.
    return rows
      .filter((row) => args.includeArchived || row.status !== "archived")
      .map((row) => ({
        _id: row._id,
        name: row.name,
        description: row.description,
        status: row.status,
        vapiAssistantId: row.vapiAssistantId,
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
      }));
  },
});

export const get = query({
  args: { assistantId: v.id("vapiAssistants") },
  handler: async (ctx, args) => {
    const assistant = await ctx.db.get("vapiAssistants", args.assistantId);
    if (!assistant) {
      return null;
    }
    await requireWorkspaceMember(ctx, assistant.workspaceId);
    return assistant;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    config: v.optional(vapiAssistantConfigValidator),
  },
  handler: async (ctx, args): Promise<Id<"vapiAssistants">> => {
    const auth = await requireWorkspaceMember(ctx, args.workspaceId);
    const now = Date.now();
    const name = normalizeVapiAssistantName(args.name ?? "Untitled assistant");
    const config = normalizeVapiAssistantConfig(args.config ?? DEFAULT_VAPI_ASSISTANT_CONFIG);

    return await ctx.db.insert("vapiAssistants", {
      workspaceId: args.workspaceId,
      name,
      description: args.description?.trim() || undefined,
      status: "draft",
      config,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const save = mutation({
  args: {
    assistantId: v.id("vapiAssistants"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    config: vapiAssistantConfigValidator,
  },
  handler: async (ctx, args): Promise<null> => {
    const assistant = await ctx.db.get("vapiAssistants", args.assistantId);
    if (!assistant) {
      throw new Error("Assistant not found");
    }
    if (assistant.status === "archived") {
      throw new Error("Archived assistants cannot be edited");
    }
    await requireWorkspaceMember(ctx, assistant.workspaceId);

    const name = args.name === undefined ? assistant.name : normalizeVapiAssistantName(args.name);
    const description =
      args.description === undefined ? assistant.description : args.description.trim() || undefined;
    const config = normalizeVapiAssistantConfig(args.config);

    const unchanged =
      assistant.name === name &&
      (assistant.description ?? "") === (description ?? "") &&
      JSON.stringify(assistant.config) === JSON.stringify(config);
    if (unchanged) {
      // Avoid bumping `updatedAt` for a no-op save; it would look like an
      // unpublished change after the assistant was already published.
      return null;
    }

    await ctx.db.patch("vapiAssistants", assistant._id, {
      name,
      description,
      config,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const archive = mutation({
  args: { assistantId: v.id("vapiAssistants") },
  handler: async (ctx, args): Promise<null> => {
    const assistant = await ctx.db.get("vapiAssistants", args.assistantId);
    if (!assistant) {
      throw new Error("Assistant not found");
    }
    await requireWorkspaceMember(ctx, assistant.workspaceId);
    await ctx.db.patch("vapiAssistants", assistant._id, {
      status: "archived",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Used by the publish action, which has no database context of its own. */
export const getForPublish = internalQuery({
  args: { assistantId: v.id("vapiAssistants"), userId: v.string() },
  handler: async (ctx, args): Promise<PublishData> => {
    const assistant = await ctx.db.get("vapiAssistants", args.assistantId);
    if (!assistant) {
      throw new Error("Assistant not found");
    }
    if (assistant.status === "archived") {
      throw new Error("Archived assistants cannot be published");
    }

    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspaceId_and_userId", (q) =>
        q.eq("workspaceId", assistant.workspaceId).eq("userId", args.userId),
      )
      .unique();
    if (!member) {
      throw new Error("You are not a member of this workspace");
    }

    return {
      assistantId: assistant._id,
      workspaceId: assistant.workspaceId,
      name: assistant.name,
      config: assistant.config,
      vapiAssistantId: assistant.vapiAssistantId ?? null,
    };
  },
});

export const markPublished = internalMutation({
  args: {
    assistantId: v.id("vapiAssistants"),
    vapiAssistantId: v.string(),
    config: vapiAssistantConfigValidator,
  },
  handler: async (ctx, args): Promise<null> => {
    const assistant = await ctx.db.get("vapiAssistants", args.assistantId);
    if (!assistant) {
      throw new Error("Assistant not found");
    }

    const now = Date.now();
    await ctx.db.patch("vapiAssistants", args.assistantId, {
      status: "published",
      vapiAssistantId: args.vapiAssistantId,
      publishedConfig: args.config,
      publishedAt: now,
      // Keep `updatedAt` intact so `updatedAt > publishedAt` can indicate
      // edits made after the last publish.
    });

    return null;
  },
});

/**
 * Creates or updates the live Vapi assistant. Vapi is the source of truth for
 * the assistant itself; the local row stores the draft and the link.
 */
export const publish = action({
  args: { assistantId: v.id("vapiAssistants") },
  handler: async (
    ctx,
    args,
  ): Promise<{ vapiAssistantId: string; created: boolean; vapiDashboardUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const data = await ctx.runQuery(internal.vapiAssistants.getForPublish, {
      assistantId: args.assistantId,
      userId: identity.subject,
    });

    await rateLimiter.limit(ctx, "publishVapiAssistant", {
      key: `${data.workspaceId}:${args.assistantId}`,
      throws: true,
    });

    const apiKey = requireVapiApiKey();
    const payload = buildVapiPayload(data.name, data.config);
    const existingId = data.vapiAssistantId;
    const creating = existingId === null;
    const url = creating
      ? `${VAPI_API_BASE}/assistant`
      : `${VAPI_API_BASE}/assistant/${encodeURIComponent(existingId)}`;

    const response = await fetch(url, {
      method: creating ? "POST" : "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new ConvexError({
        code: "VAPI_PUBLISH_FAILED",
        message: `Vapi rejected the assistant (${response.status}): ${bodyText.slice(0, 500)}`,
      });
    }

    let parsed: unknown = null;
    try {
      parsed = bodyText.length > 0 ? JSON.parse(bodyText) : null;
    } catch {
      parsed = null;
    }

    const vapiAssistantId = assistantIdFromPayload(parsed) ?? data.vapiAssistantId;
    if (!vapiAssistantId) {
      throw new ConvexError({
        code: "VAPI_PUBLISH_FAILED",
        message: "Vapi accepted the request but did not return an assistant id.",
      });
    }

    await ctx.runMutation(internal.vapiAssistants.markPublished, {
      assistantId: args.assistantId,
      vapiAssistantId,
      config: data.config,
    });

    return {
      vapiAssistantId,
      created: creating,
      vapiDashboardUrl: `https://dashboard.vapi.ai/assistants/${vapiAssistantId}`,
    };
  },
});
