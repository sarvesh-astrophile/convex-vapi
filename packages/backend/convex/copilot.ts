import { Agent, createThread } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { Output } from "ai";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { generatedAgentConfigSchema, type GeneratedAgentConfig } from "./lib/agentConfig";
import { throwAiGatewayError } from "./lib/aiErrors";
import { rateLimiter } from "./rateLimits";

const builderAgent = new Agent(components.agent, {
  name: "Builder Copilot",
  languageModel: convexGateway("openai/gpt-4o-mini"),
  instructions:
    "You help product builders design Sarvam voice agents running on Cloudflare Agents. Suggest concise system prompts, first messages, LLM settings, Sarvam voice/transcriber choices, and tool schemas. Return practical text. Do not invent Cloudflare or Sarvam API endpoints.",
});

export const assertMember = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspaceId_and_userId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId),
      )
      .unique();
    if (!member) {
      throw new Error("You are not a member of this workspace");
    }
    return { role: member.role };
  },
});

export const findThread = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("copilotThreads")
      .withIndex("by_userId_and_workspaceId", (q) =>
        q.eq("userId", args.userId).eq("workspaceId", args.workspaceId),
      )
      .unique();
    return thread?.threadId ?? null;
  },
});

export const saveThread = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("copilotThreads")
      .withIndex("by_userId_and_workspaceId", (q) =>
        q.eq("userId", args.userId).eq("workspaceId", args.workspaceId),
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch("copilotThreads", existing._id, {
        threadId: args.threadId,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.insert("copilotThreads", {
      workspaceId: args.workspaceId,
      userId: args.userId,
      threadId: args.threadId,
      createdAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const chat = action({
  args: {
    workspaceId: v.id("workspaces"),
    prompt: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ threadId: string; text: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const prompt = args.prompt.trim();
    if (prompt.length === 0) {
      throw new Error("Prompt is required");
    }
    if (prompt.length > 4_000) {
      throw new Error("Prompt is too long");
    }

    await ctx.runQuery(internal.copilot.assertMember, {
      workspaceId: args.workspaceId,
      userId: identity.subject,
    });

    await rateLimiter.limit(ctx, "copilot", {
      key: identity.subject,
      throws: true,
    });

    let threadId = await ctx.runQuery(internal.copilot.findThread, {
      workspaceId: args.workspaceId,
      userId: identity.subject,
    });

    if (!threadId) {
      threadId = await createThread(ctx, components.agent, {
        userId: identity.subject,
        title: "Builder Copilot",
      });
      await ctx.runMutation(internal.copilot.saveThread, {
        workspaceId: args.workspaceId,
        userId: identity.subject,
        threadId,
      });
    }

    const context =
      args.context && args.context.trim().length > 0
        ? `\n\nCurrent agent draft (JSON):\n${args.context.slice(0, 8_000)}`
        : "";

    let result;
    try {
      result = await builderAgent.generateText(
        ctx,
        { threadId, userId: identity.subject },
        {
          prompt: `You are helping configure a Sarvam voice agent running on Cloudflare Agents.${context}\n\nUser request:\n${prompt}\n\nAnswer with concrete suggested text or settings. Keep it under 300 words.`,
        },
      );
    } catch (error) {
      throwAiGatewayError(error, "Copilot");
    }

    return { threadId, text: result.text };
  },
});

export const generateConfig = action({
  args: {
    workspaceId: v.id("workspaces"),
    prompt: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<GeneratedAgentConfig> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const prompt = args.prompt.trim();
    if (prompt.length === 0) {
      throw new Error("Describe the agent you want to build");
    }
    if (prompt.length > 4_000) {
      throw new Error("Prompt is too long");
    }

    await ctx.runQuery(internal.copilot.assertMember, {
      workspaceId: args.workspaceId,
      userId: identity.subject,
    });

    await rateLimiter.limit(ctx, "copilot", {
      key: identity.subject,
      throws: true,
    });

    const context =
      args.context && args.context.trim().length > 0
        ? `\n\nCurrent draft (JSON):\n${args.context.slice(0, 8_000)}`
        : "";

    try {
      const result = await builderAgent.generateText(
        ctx,
        { userId: identity.subject },
        {
          output: Output.object({ schema: generatedAgentConfigSchema }),
          prompt: `Create a complete, publishable Sarvam voice-agent configuration.

Requirements:
- Default model: sarvam/sarvam-105b. Default voice: sarvam/shubh with model bulbul:v3. Default transcriber: sarvam/saaras:v4 with language unknown and mode codemix. Only deviate when the user asks for a specific provider or language.
- The systemPrompt must be ready for a spoken agent: role, tone, constraints, escalation behavior, and when to end the call.
- The firstMessage must sound natural when spoken.
- If the brief asks for multiple languages, use transcriber mode 'codemix' or 'translit' and make the systemPrompt explicitly handle both languages.
- Keep the systemPrompt focused and under 400 words.
- Only add tools when the brief needs one. Each tool needs a snake_case name, a one-line description, JSON Schema parameters, and an https endpoint. Leave tools empty otherwise.
- The name and description must be short and human-readable.
${context}

User brief:
${prompt}`,
        },
      );

      if (!result.output) {
        throw new Error("The model returned no structured configuration");
      }

      return result.output as GeneratedAgentConfig;
    } catch (error) {
      throwAiGatewayError(error, "Copilot");
    }
  },
});
