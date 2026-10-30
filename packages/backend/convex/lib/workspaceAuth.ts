import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

export type WorkspaceRole = "owner" | "admin" | "member";

export type WorkspaceAuth = {
  userId: string;
  workspaceId: Id<"workspaces">;
  role: WorkspaceRole;
};

export async function requireUserId(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthenticated");
  }
  // With Convex Better Auth, `subject` is the Better Auth user id.
  return identity.subject;
}

export async function requireWorkspaceMember(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<WorkspaceAuth> {
  const userId = await requireUserId(ctx);
  const member = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspaceId_and_userId", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .unique();

  if (!member) {
    throw new Error("You are not a member of this workspace");
  }

  return { userId, workspaceId, role: member.role };
}

export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  roles: readonly WorkspaceRole[],
): Promise<WorkspaceAuth> {
  const auth = await requireWorkspaceMember(ctx, workspaceId);
  if (!roles.includes(auth.role)) {
    throw new Error("You do not have permission to perform this action");
  }
  return auth;
}
