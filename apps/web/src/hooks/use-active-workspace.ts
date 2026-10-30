import { api } from "@convex-vapi/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

/**
 * Resolves the active workspace and creates a personal workspace on first use.
 * All agent/tool mutations still pass `workspaceId` to the server, which
 * re-checks membership before writing.
 */
export function useActiveWorkspace() {
  const { isAuthenticated } = useConvexAuth();
  const workspace = useQuery(api.workspaces.getActive, isAuthenticated ? {} : "skip");
  const ensurePersonal = useMutation(api.workspaces.ensurePersonal);

  useEffect(() => {
    if (isAuthenticated && workspace === null) {
      void ensurePersonal().catch(() => {
        // The page will keep showing the setup state if this fails.
      });
    }
  }, [ensurePersonal, isAuthenticated, workspace]);

  return {
    workspace,
    isLoading: workspace === undefined,
    ensurePersonal,
  };
}

export function useWorkspaces() {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.workspaces.listMine, isAuthenticated ? {} : "skip");
}
