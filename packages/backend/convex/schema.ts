import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { agentConfigValidator } from "./lib/agentConfig";

export default defineSchema({
  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    createdAt: v.number(),
  })
    .index("by_workspaceId_and_userId", ["workspaceId", "userId"])
    .index("by_userId", ["userId"]),

  userWorkspaceState: defineTable({
    userId: v.string(),
    activeWorkspaceId: v.id("workspaces"),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  agents: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("published"), v.literal("archived")),
    currentVersionId: v.optional(v.id("agentVersions")),
    publishedVersionId: v.optional(v.id("agentVersions")),
    vapiAssistantId: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspaceId_and_updatedAt", ["workspaceId", "updatedAt"])
    .index("by_vapiAssistantId", ["vapiAssistantId"]),

  agentVersions: defineTable({
    agentId: v.id("agents"),
    workspaceId: v.id("workspaces"),
    version: v.number(),
    config: agentConfigValidator,
    vapiAssistantId: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_agentId_and_version", ["agentId", "version"])
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"]),

  copilotThreads: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    threadId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_workspaceId", ["userId", "workspaceId"])
    .index("by_threadId", ["threadId"]),

  calls: defineTable({
    callId: v.string(),
    userId: v.optional(v.string()),
    workspaceId: v.optional(v.id("workspaces")),
    agentId: v.optional(v.id("agents")),
    assistantId: v.optional(v.string()),
    type: v.optional(v.string()),
    status: v.string(),
    endedReason: v.optional(v.string()),
    summary: v.optional(v.string()),
    transcript: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    cost: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_callId", ["callId"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"])
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"])
    .index("by_agentId_and_createdAt", ["agentId", "createdAt"])
    .index("by_status", ["status"]),

  callTurns: defineTable({
    callId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    at: v.number(),
    key: v.string(),
  })
    .index("by_callId_and_at", ["callId", "at"])
    .index("by_key", ["key"]),

  webhookEvents: defineTable({
    eventHash: v.string(),
    eventType: v.string(),
    callId: v.optional(v.string()),
    payload: v.string(),
    receivedAt: v.number(),
  })
    .index("by_eventHash", ["eventHash"])
    .index("by_callId_and_receivedAt", ["callId", "receivedAt"]),
});
