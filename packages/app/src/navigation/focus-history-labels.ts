import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { NavigationFocusLocation } from "./focus-history";

export interface FocusLocationLabel {
  title: string;
  subtitle: string | null;
}

export interface FocusLocationLabelDeps {
  workspaceTitle(serverId: string, workspaceId: string): string | null;
  agentTitle(serverId: string, agentId: string): string | null;
  t(key: string): string;
}

// Keys under shell.recentWorkspaces.routes; matched by prefix, longest first.
const ROUTE_LABEL_KEYS: readonly (readonly [prefix: string, key: string])[] = [
  ["/settings", "settings"],
  ["/open-project", "openProject"],
  ["/new", "new"],
  ["/sessions", "sessions"],
  ["/schedules", "schedules"],
  ["/views", "views"],
  ["/pair-scan", "pairScan"],
];

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

function tabLabel(
  serverId: string,
  target: WorkspaceTabTarget | null,
  deps: FocusLocationLabelDeps,
): string | null {
  switch (target?.kind) {
    case "agent":
      return deps.agentTitle(serverId, target.agentId) || deps.t("shell.commandCenter.newAgent");
    case "terminal":
      return deps.t("shell.recentWorkspaces.tabs.terminal");
    case "browser":
      return deps.t("shell.recentWorkspaces.tabs.browser");
    case "changes_tree":
    case "working_diff":
      return deps.t("workspace.tabs.actions.changes");
    case "files":
      return deps.t("workspace.tabs.actions.files");
    case "pull_request":
      return deps.t("workspace.tabs.actions.pullRequest");
    case "file":
      return basename(target.path) || null;
    default:
      return null;
  }
}

/** What a Back/Forward history row says: the tab first, then the workspace it is in. */
export function describeFocusLocation(
  location: NavigationFocusLocation,
  deps: FocusLocationLabelDeps,
): FocusLocationLabel {
  if (location.kind === "route") {
    const match = ROUTE_LABEL_KEYS.find(([prefix]) => location.pathname.startsWith(prefix));
    return {
      title: match ? deps.t(`shell.recentWorkspaces.routes.${match[1]}`) : location.pathname,
      subtitle: null,
    };
  }
  const workspace =
    deps.workspaceTitle(location.serverId, location.workspaceId) ?? location.workspaceId;
  const tab = tabLabel(location.serverId, location.target, deps);
  return tab ? { title: tab, subtitle: workspace } : { title: workspace, subtitle: null };
}
