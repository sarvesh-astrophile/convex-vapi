import { Agent, createThread, createTool, listMessages, stepCountIs } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { throwAiGatewayError } from "./lib/aiErrors";
import {
  normalizeVapiAssistantConfig,
  normalizeVapiAssistantName,
  vapiAssistantConfigValidator,
  vapiDraftUpdateSchema,
  type VapiAssistantConfig,
} from "./lib/vapiAssistantConfig";
import { requireWorkspaceMember } from "./lib/workspaceAuth";
import { rateLimiter } from "./rateLimits";

export type BuilderChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
};

type BuilderAssistant = {
  assistantId: Id<"vapiAssistants">;
  workspaceId: Id<"workspaces">;
  name: string;
  description?: string;
  config: VapiAssistantConfig;
};

const updateDraftTool = createTool({
  description:
    "Replace the current Vapi assistant draft. Call this whenever the user asks to create an assistant or change any part of it. Always send the complete draft, never a partial patch.",
  inputSchema: vapiDraftUpdateSchema,
  execute: async (ctx, input) => {
    if (!ctx.threadId || !ctx.userId) {
      throw new Error("The builder conversation is missing its thread or user");
    }

    return await ctx.runMutation(internal.vapiBuilder.applyDraftFromThread, {
      threadId: ctx.threadId,
      userId: ctx.userId,
      name: input.name,
      description: input.description,
      config: input.config,
    });
  },
});

const builderAgent = new Agent(components.agent, {
  name: "Vapi Assistant Builder",
  languageModel: convexGateway("openai/gpt-4o-mini"),
  instructions: "You help users design production-ready Vapi voice assistants.",
  tools: { updateDraft: updateDraftTool },
  stopWhen: stepCountIs(4),
});

function builderSystemPrompt(assistant: BuilderAssistant): string {
  return `You are the Vapi voice-agent builder inside Kelasa. You help a workspace design, refine, and publish Vapi assistants.

You can call \`updateDraft\` to replace the current draft. Call it whenever the user asks to create an assistant or change any field. Send the complete updated draft, never a partial patch. If the user asks a question or wants advice without changing the assistant, answer directly and do not call the tool.

Vapi configuration rules:
- \`firstMessage\` is spoken when the call connects. Keep it natural and short.
- \`systemPrompt\` becomes the Vapi model's system message. Include role, tone, constraints, escalation behavior, and when to end the call. Keep it under 400 words.
- Default to model provider \`openai\` with model \`gpt-4o-mini\`, voice provider \`vapi\` with voiceId \`Elliot\`, and transcriber provider \`deepgram\` with model \`nova-3\` and language \`en\`. Only change these when the user asks.
- For multilingual agents, set the transcriber language to \`multi\` and make the system prompt explicit about the languages.
- \`maxDurationSeconds\` must be 10–43200. \`silenceTimeoutSeconds\` must be 5–120.
- Never invent endpoints, tools, credentials, or provider ids. Never mention this JSON or the tool to the user.

Current assistant draft (authoritative):
${JSON.stringify(
  {
    name: assistant.name,
    description: assistant.description ?? "",
    config: assistant.config,
  },
  null,
  2,
)}

Write the chat reply in plain text. Be concise and practical.`;
}

export const getAssistantForBuilder = internalQuery({
  args: { assistantId: v.id("vapiAssistants"), userId: v.string() },
  handler: async (ctx, args): Promise<BuilderAssistant> => {
    const assistant = await ctx.db.get("vapiAssistants", args.assistantId);
    if (!assistant) {
      throw new Error("Assistant not found");
    }
    if (assistant.status === "archived") {
      throw new Error("Archived assistants cannot be edited");
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
      ...(assistant.description ? { description: assistant.description } : {}),
      config: assistant.config,
    };
  },
});

export const findThread = internalQuery({
  args: { assistantId: v.id("vapiAssistants"), userId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const thread = await ctx.db
      .query("vapiBuilderThreads")
      .withIndex("by_assistantId_and_userId", (q) =>
        q.eq("assistantId", args.assistantId).eq("userId", args.userId),
      )
      .unique();
    return thread?.threadId ?? null;
  },
});

export const saveThread = internalMutation({
  args: {
    assistantId: v.id("vapiAssistants"),
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("vapiBuilderThreads")
      .withIndex("by_assistantId_and_userId", (q) =>
        q.eq("assistantId", args.assistantId).eq("userId", args.userId),
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch("vapiBuilderThreads", existing._id, {
        threadId: args.threadId,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.insert("vapiBuilderThreads", {
      assistantId: args.assistantId,
      workspaceId: args.workspaceId,
      userId: args.userId,
      threadId: args.threadId,
      createdAt: now,
      updatedAt: now,
    });
    return null;
  },
});

/** Applies a tool call from the builder agent to the draft it belongs to. */
export const applyDraftFromThread = internalMutation({
  args: {
    threadId: v.string(),
    userId: v.string(),
    name: v.string(),
    description: v.string(),
    config: vapiAssistantConfigValidator,
  },
  handler: async (ctx, args): Promise<{ assistantId: string; changed: boolean }> => {
    const thread = await ctx.db
      .query("vapiBuilderThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!thread) {
      throw new Error("Builder conversation not found");
    }
    if (thread.userId !== args.userId) {
      throw new Error("This builder conversation belongs to another user");
    }

    const assistant = await ctx.db.get("vapiAssistants", thread.assistantId);
    if (!assistant) {
      throw new Error("Assistant not found");
    }
    if (assistant.status === "archived") {
      throw new Error("Archived assistants cannot be edited");
    }

    const name = normalizeVapiAssistantName(args.name);
    const config = normalizeVapiAssistantConfig(args.config);
    const description = args.description.trim() || undefined;

    const changed =
      assistant.name !== name ||
      (assistant.description ?? "") !== (description ?? "") ||
      JSON.stringify(assistant.config) !== JSON.stringify(config);

    if (changed) {
      await ctx.db.patch("vapiAssistants", assistant._id, {
        name,
        description,
        config,
        updatedAt: Date.now(),
      });
    }

    return { assistantId: assistant._id, changed };
  },
});

export const messages = query({
  args: { assistantId: v.id("vapiAssistants") },
  handler: async (ctx, args): Promise<BuilderChatMessage[]> => {
    const assistant = await ctx.db.get("vapiAssistants", args.assistantId);
    if (!assistant) {
      return [];
    }
    const auth = await requireWorkspaceMember(ctx, assistant.workspaceId);

    const thread = await ctx.db
      .query("vapiBuilderThreads")
      .withIndex("by_assistantId_and_userId", (q) =>
        q.eq("assistantId", args.assistantId).eq("userId", auth.userId),
      )
      .unique();
    if (!thread) {
      return [];
    }

    const result = await listMessages(ctx, components.agent, {
      threadId: thread.threadId,
      paginationOpts: { numItems: 80, cursor: null },
      excludeToolMessages: true,
    });

    const messages: BuilderChatMessage[] = [];
    // The component returns newest first; the chat renders oldest first.
    for (const doc of [...result.page].reverse()) {
      const role = doc.message?.role;
      if (role !== "user" && role !== "assistant") {
        continue;
      }
      const text = doc.text?.trim();
      if (!text) {
        continue;
      }
      messages.push({
        id: doc._id,
        role,
        text,
        createdAt: doc._creationTime,
      });
    }
    return messages;
  },
});

/**
 * One chat turn. The agent answers in text and may call `updateDraft` to apply
 * changes to the assistant draft. The Convex Agent component persists both
 * sides of the conversation; `messages` streams them back to the UI.
 */
export const chat = action({
  args: { assistantId: v.id("vapiAssistants"), prompt: v.string() },
  handler: async (ctx, args): Promise<{ threadId: string; reply: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const prompt = args.prompt.trim();
    if (prompt.length === 0) {
      throw new Error("Describe the assistant you want to build");
    }
    if (prompt.length > 2_000) {
      throw new Error("Prompt is too long");
    }

    const assistant = await ctx.runQuery(internal.vapiBuilder.getAssistantForBuilder, {
      assistantId: args.assistantId,
      userId: identity.subject,
    });

    await rateLimiter.limit(ctx, "vapiBuilder", {
      key: `${assistant.workspaceId}:${identity.subject}`,
      throws: true,
    });

    let threadId = await ctx.runQuery(internal.vapiBuilder.findThread, {
      assistantId: args.assistantId,
      userId: identity.subject,
    });

    if (!threadId) {
      threadId = await createThread(ctx, components.agent, {
        userId: identity.subject,
        title: `Builder: ${assistant.name}`,
      });
      await ctx.runMutation(internal.vapiBuilder.saveThread, {
        assistantId: args.assistantId,
        workspaceId: assistant.workspaceId,
        userId: identity.subject,
        threadId,
      });
    }

    try {
      const result = await builderAgent.generateText(
        ctx,
        { threadId, userId: identity.subject },
        {
          system: builderSystemPrompt(assistant),
          prompt,
        },
      );

      return { threadId, reply: result.text };
    } catch (error) {
      throwAiGatewayError(error, "Builder");
    }
  },
});
