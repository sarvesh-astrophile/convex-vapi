import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { agentConfigValidator } from "./lib/agentConfig";
import { callStatusValidator } from "./lib/callStatus";

const legacyRuntimeValidator = v.union(v.literal("vapi"), v.literal("cloudflare"));

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
    // `vapi` is only accepted so pre-migration rows stay patchable.
    runtime: v.optional(legacyRuntimeValidator),
    publishedRuntime: v.optional(legacyRuntimeValidator),
    currentVersionId: v.optional(v.id("agentVersions")),
    publishedVersionId: v.optional(v.id("agentVersions")),
    /** Legacy Vapi link. No longer written or read. */
    vapiAssistantId: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspaceId_and_updatedAt", ["workspaceId", "updatedAt"]),

  agentVersions: defineTable({
    agentId: v.id("agents"),
    workspaceId: v.id("workspaces"),
    version: v.number(),
    config: agentConfigValidator,
    /** Legacy Vapi link. No longer written or read. */
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

  /**
   * The call is the aggregate root. One Durable Object per call writes a live
   * event stream here, so a call survives a closed tab, a runtime crash, or a
   * dropped webhook delivery.
   */
  calls: defineTable({
    callId: v.string(),
    userId: v.optional(v.string()),
    workspaceId: v.optional(v.id("workspaces")),
    agentId: v.optional(v.id("agents")),
    /** Published config version this call ran, for regression attribution. */
    agentVersionId: v.optional(v.id("agentVersions")),
    /** Reserved for telephony; empty for browser calls. */
    phoneNumber: v.optional(v.string()),
    customerNumber: v.optional(v.string()),
    status: callStatusValidator,
    /** Highest applied event seq. Guards against replayed or reordered batches. */
    lastSeq: v.optional(v.number()),
    endedReason: v.optional(v.string()),
    modelProvider: v.optional(v.string()),
    modelName: v.optional(v.string()),
    summary: v.optional(v.string()),
    transcript: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),

    // Legacy Vapi-era columns. Kept optional so old rows stay patchable; the
    // runtime no longer writes or reads them.
    assistantId: v.optional(v.string()),
    runtime: v.optional(legacyRuntimeValidator),
    sessionId: v.optional(v.string()),
    type: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    cost: v.optional(v.number()),
  })
    .index("by_callId", ["callId"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"])
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"])
    .index("by_workspaceId_and_status", ["workspaceId", "status"])
    .index("by_agentId_and_createdAt", ["agentId", "createdAt"])
    .index("by_status", ["status"]),

  /**
   * Maps a `convex-vapi` component call back to the workspace that placed it.
   * The component's own tables are isolated and have no tenancy columns, so
   * this is the authorization boundary for Vapi call history.
   */
  vapiCalls: defineTable({
    callId: v.string(),
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    assistantId: v.string(),
    phoneNumberId: v.string(),
    customerNumber: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_callId", ["callId"])
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"]),

  callTurns: defineTable({
    callId: v.string(),
    /** Monotonic per call. Optional only so pre-migration rows stay valid. */
    seq: v.optional(v.number()),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    at: v.number(),
    key: v.string(),
  })
    .index("by_callId_and_seq", ["callId", "seq"])
    .index("by_callId_and_at", ["callId", "at"])
    .index("by_key", ["key"]),

  /**
   * Domain audit log: status transitions, guard rejections, dropped sentences,
   * tool invocations, errors. Separate from raw webhook deliveries so queries
   * never have to parse a payload blob.
   */
  callEvents: defineTable({
    callId: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
    seq: v.number(),
    /** "call.started" | "call.status" | "transcript.rejected" | ... */
    kind: v.string(),
    at: v.number(),
    reason: v.optional(v.string()),
    text: v.optional(v.string()),
    /** JSON: tool arguments/results, error detail. */
    data: v.optional(v.string()),
  })
    .index("by_callId_and_seq", ["callId", "seq"])
    .index("by_callId_and_kind", ["callId", "kind"])
    .index("by_workspaceId_and_at", ["workspaceId", "at"]),

  /** One row per call: the metering record billing and dashboards read. */
  callUsage: defineTable({
    callId: v.string(),
    workspaceId: v.id("workspaces"),
    turns: v.number(),
    sttAudioMs: v.number(),
    ttsCharacters: v.number(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    llmMs: v.number(),
    ttsMs: v.number(),
    firstAudioMs: v.number(),
  })
    .index("by_callId", ["callId"])
    .index("by_workspaceId", ["workspaceId"]),

  /** Short-lived, single-call capability minted by `calls.start`. */
  callSessions: defineTable({
    callId: v.string(),
    tokenHash: v.string(),
    agentId: v.id("agents"),
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_callId", ["callId"])
    .index("by_tokenHash", ["tokenHash"])
    .index("by_expiresAt", ["expiresAt"]),

  /** Raw transport audit. Replay/debug only; never queried for domain data. */
  webhookEvents: defineTable({
    /** Optional only so pre-migration delivery rows stay valid. */
    eventId: v.optional(v.string()),
    /** Legacy Vapi delivery hash. Superseded by `eventId`. */
    eventHash: v.optional(v.string()),
    eventType: v.string(),
    callId: v.optional(v.string()),
    payload: v.string(),
    receivedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_callId_and_receivedAt", ["callId", "receivedAt"]),
});
