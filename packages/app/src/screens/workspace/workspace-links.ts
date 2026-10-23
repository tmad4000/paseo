import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";
import {
  buildHostAgentDetailRoute,
  buildHostWorkspaceOpenRoute,
  buildHostWorkspaceRoute,
  encodeFilePathForPathSegment,
  encodeWorkspaceIdForPathSegment,
} from "@/utils/host-routes";

export { buildHostWorkspaceRoute as buildWorkspaceLinkRoute };

export function buildTabLinkRoute(
  serverId: string,
  workspaceId: string,
  tab: WorkspaceTabDescriptor | null,
): string | null {
  if (!tab) return null;
  const scope = tab.scope ?? { serverId, workspaceId };
  const target = tab.target;
  let open: string;
  switch (target.kind) {
    case "agent":
      // Stable session links follow the agent even if its workspace changes.
      return buildHostAgentDetailRoute(scope.serverId, target.agentId);
    case "terminal":
      open = `terminal:${target.terminalId}`;
      break;
    case "file":
      open = `file:${encodeFilePathForPathSegment(target.path)}`;
      break;
    case "setup":
      open = `setup:${encodeWorkspaceIdForPathSegment(target.workspaceId)}`;
      break;
    default:
      // Drafts, browsers and other local-only tabs have no portable route target.
      return null;
  }
  return buildHostWorkspaceOpenRoute(scope.serverId, scope.workspaceId, open);
}

export function buildWorkspaceShareUrl(
  route: string,
  origin: string | null,
  scheme = "paseo-fork",
): string {
  // Routes are already encoded. Passing them to Linking.createURL would encode percent signs again.
  return origin ? new URL(route, origin).href : `${scheme}:/${route}`;
}
