import { v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireRole, requireWorkspaceMember } from "./lib/workspaceAuth";

async function getUserId(ctx: QueryCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

function personalSlug(userId: string): string {
  const safeId = userId
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 20)
    .toLowerCase();
  return `personal-${safeId}`;
}

export const ensurePersonal = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }
    const userId = identity.subject;
    const now = Date.now();
    const slug = personalSlug(userId);

    const existingBySlug = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    let workspace = existingBySlug;

    if (!workspace) {
      const workspaceId = await ctx.db.insert("workspaces", {
        name: identity.name ? `${identity.name}'s workspace` : "Personal workspace",
        slug,
        ownerId: userId,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId,
        role: "owner",
        createdAt: now,
      });

      workspace = await ctx.db.get("workspaces", workspaceId);
      if (!workspace) {
        throw new Error("Failed to create workspace");
      }
    }

    const state = await ctx.db
      .query("userWorkspaceState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (state) {
      await ctx.db.patch("userWorkspaceState", state._id, {
        activeWorkspaceId: workspace._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userWorkspaceState", {
        userId,
        activeWorkspaceId: workspace._id,
        updatedAt: now,
      });
    }

    return workspace;
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) {
      return [];
    }
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(50);

    const workspaces = await Promise.all(
      memberships.map(async (membership) => {
        const workspace = await ctx.db.get("workspaces", membership.workspaceId);
        return workspace ? { workspace, role: membership.role } : null;
      }),
    );

    return workspaces.filter((entry) => entry !== null);
  },
});

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) {
      return null;
    }

    const state = await ctx.db
      .query("userWorkspaceState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (state) {
      const membership = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspaceId_and_userId", (q) =>
          q.eq("workspaceId", state.activeWorkspaceId).eq("userId", userId),
        )
        .unique();
      if (membership) {
        const workspace = await ctx.db.get("workspaces", state.activeWorkspaceId);
        if (workspace) {
          return workspace;
        }
      }
    }

    const firstMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!firstMembership) {
      return null;
    }

    return await ctx.db.get("workspaces", firstMembership.workspaceId);
  },
});

export const setActive = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceMember(ctx, args.workspaceId);
    const now = Date.now();

    const state = await ctx.db
      .query("userWorkspaceState")
      .withIndex("by_userId", (q) => q.eq("userId", auth.userId))
      .unique();

    if (state) {
      await ctx.db.patch("userWorkspaceState", state._id, {
        activeWorkspaceId: args.workspaceId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userWorkspaceState", {
        userId: auth.userId,
        activeWorkspaceId: args.workspaceId,
        updatedAt: now,
      });
    }

    return null;
  },
});

export const rename = mutation({
  args: { workspaceId: v.id("workspaces"), name: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.workspaceId, ["owner", "admin"]);
    const name = args.name.trim();
    if (name.length === 0) {
      throw new Error("Workspace name is required");
    }

    await ctx.db.patch("workspaces", args.workspaceId, {
      name,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const listMembers = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspaceId_and_userId", (q) => q.eq("workspaceId", args.workspaceId))
      .take(100);
  },
});
