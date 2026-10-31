import { v } from "convex/values";
import { Vapi } from "convex-vapi";

import type { Doc } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireWorkspaceMember } from "./lib/workspaceAuth";
import { rateLimiter } from "./rateLimits";

const vapi = new Vapi(components.convexVapi, {
  apiKey: process.env.VAPI_API_KEY ?? "",
  webhookSecret: process.env.VAPI_WEBHOOK_SECRET ?? "",
});

type VapiCall = NonNullable<Awaited<ReturnType<typeof vapi.getCall>>>;
type VapiCallOwner = Doc<"vapiCalls">;

async function getUserId(ctx: QueryCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity ? identity.subject : null;
}

function requireVapiApiKey(): void {
  if (!process.env.VAPI_API_KEY) {
    throw new Error("VAPI_API_KEY is not configured on the Convex deployment");
  }
}

function normalizeId(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function normalizeCustomerNumber(value: string): string {
  const trimmed = value.trim();
  if (!/^\+[1-9]\d{6,14}$/.test(trimmed)) {
    throw new Error("Customer number must be in E.164 format, e.g. +14155552671");
  }
  return trimmed;
}

/**
 * Verifies workspace membership for an action. Actions do not carry a Convex
 * database context, so the caller's id is passed explicitly into this internal
 * query rather than read from `ctx.auth` in a nested function.
 */
export const assertMember = internalQuery({
  args: { workspaceId: v.id("workspaces"), userId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspaceId_and_userId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId),
      )
      .unique();
    if (!member) {
      throw new Error("You are not a member of this workspace");
    }
    return null;
  },
});

/** Returns the ownership row for a call after checking the caller's membership. */
export const assertCallOwner = internalQuery({
  args: { callId: v.string(), userId: v.string() },
  handler: async (ctx, args): Promise<VapiCallOwner> => {
    const owner = await ctx.db
      .query("vapiCalls")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .unique();
    if (!owner) {
      throw new Error("Call not found");
    }
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspaceId_and_userId", (q) =>
        q.eq("workspaceId", owner.workspaceId).eq("userId", args.userId),
      )
      .unique();
    if (!member) {
      throw new Error("You are not a member of this workspace");
    }
    return owner;
  },
});

export const recordOwnership = internalMutation({
  args: {
    callId: v.string(),
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    assistantId: v.string(),
    phoneNumberId: v.string(),
    customerNumber: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("vapiCalls")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .unique();

    if (existing) {
      await ctx.db.patch("vapiCalls", existing._id, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        assistantId: args.assistantId,
        phoneNumberId: args.phoneNumberId,
        customerNumber: args.customerNumber,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.insert("vapiCalls", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
    return null;
  },
});

/**
 * Places an outbound Vapi call and records which workspace owns it. The webhook
 * component writes call state; this row is the tenancy boundary for reads.
 */
export const start = action({
  args: {
    workspaceId: v.id("workspaces"),
    assistantId: v.string(),
    phoneNumberId: v.string(),
    customerNumber: v.string(),
  },
  handler: async (ctx, args): Promise<{ callId: string; status: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }
    requireVapiApiKey();

    const assistantId = normalizeId(args.assistantId, "Assistant ID");
    const phoneNumberId = normalizeId(args.phoneNumberId, "Phone number ID");
    const customerNumber = normalizeCustomerNumber(args.customerNumber);

    await ctx.runQuery(internal.vapi.assertMember, {
      workspaceId: args.workspaceId,
      userId: identity.subject,
    });

    await rateLimiter.limit(ctx, "vapiCall", {
      key: `${identity.subject}:${args.workspaceId}`,
      throws: true,
    });

    const result = await vapi.createCall(ctx, {
      assistantId,
      phoneNumberId,
      customerNumber,
    });

    await ctx.runMutation(internal.vapi.recordOwnership, {
      callId: result.callId,
      workspaceId: args.workspaceId,
      userId: identity.subject,
      assistantId,
      phoneNumberId,
      customerNumber,
    });

    return result;
  },
});

type VapiAssistantSummary = { id: string; name: string };

/**
 * Lists assistants in the Vapi account so the dialer can offer multiple
 * assistants instead of hard-coding one. Assistant management stays in Vapi.
 */
export const listAssistants = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<VapiAssistantSummary[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }
    requireVapiApiKey();

    await ctx.runQuery(internal.vapi.assertMember, {
      workspaceId: args.workspaceId,
      userId: identity.subject,
    });

    const response = await fetch("https://api.vapi.ai/assistant", {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to list Vapi assistants: ${response.status} ${await response.text()}`,
      );
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Vapi returned an unexpected assistant list");
    }

    return payload.slice(0, 100).flatMap((item) => {
      if (typeof item !== "object" || item === null) {
        return [];
      }
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : null;
      if (!id) {
        return [];
      }
      const name = typeof record.name === "string" && record.name.length > 0 ? record.name : id;
      return [{ id, name }];
    });
  },
});

/** Pulls the latest transcript/summary from Vapi when a webhook was missed. */
export const refresh = action({
  args: { callId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }
    requireVapiApiKey();

    await ctx.runQuery(internal.vapi.assertCallOwner, {
      callId: args.callId,
      userId: identity.subject,
    });

    await vapi.refreshCall(ctx, { callId: args.callId });
    return null;
  },
});

type VapiCallWithOwner = {
  call: VapiCall;
  owner: VapiCallOwner;
};

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<VapiCallWithOwner[]> => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 50);

    const owners = await ctx.db
      .query("vapiCalls")
      .withIndex("by_workspaceId_and_createdAt", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(limit);

    const calls = await Promise.all(
      owners.map(async (owner) => ({
        owner,
        call: await vapi.getCall(ctx, { callId: owner.callId }),
      })),
    );

    return calls.filter((entry): entry is VapiCallWithOwner => entry.call !== null);
  },
});

export const get = query({
  args: { callId: v.string() },
  handler: async (ctx, args): Promise<VapiCallWithOwner | null> => {
    const userId = await getUserId(ctx);
    if (!userId) {
      return null;
    }

    const owner = await ctx.db
      .query("vapiCalls")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .unique();
    if (!owner) {
      return null;
    }

    try {
      await requireWorkspaceMember(ctx, owner.workspaceId);
    } catch {
      return null;
    }

    const call = await vapi.getCall(ctx, { callId: args.callId });
    return call ? { call, owner } : null;
  },
});

export const stats = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);

    const owners = await ctx.db
      .query("vapiCalls")
      .withIndex("by_workspaceId_and_createdAt", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(200);

    const calls = await Promise.all(
      owners.map((owner) => vapi.getCall(ctx, { callId: owner.callId })),
    );
    const present = calls.filter((call): call is VapiCall => call !== null);
    const isLive = (status: string) =>
      status === "queued" || status === "ringing" || status === "in-progress";

    return {
      callCount: present.length,
      liveCount: present.filter((call) => isLive(call.status)).length,
      endedCount: present.filter((call) => call.status === "ended").length,
    };
  },
});
