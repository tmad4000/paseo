import { useEffect } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useBrowserStore } from "@/desktop/browser/store";
import { showWorkspaceTargetBeside } from "@/workspace-tabs/open-beside";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { drainUiCommands, subscribeToUiCommands } from "./queue";
import type { ResolvedUiCommand } from "./resolve";

/**
 * Applies `ui.command` pushes from the daemon. Mounted once in the app shell,
 * beside the other navigation listeners.
 *
 * A focused open goes through `navigateToWorkspace`, which opens the tab and
 * then routes to the workspace in one step. The route has to end up on that
 * workspace: the workspace screen only reconciles its tab layout while its own
 * route is focused, so a tab opened for a workspace the user never lands on is
 * never realized.
 */
export function UiCommandListener() {
  const isCompact = useIsCompactFormFactor();
  const apply = useStableEvent((command: ResolvedUiCommand) => {
    if (command.command === "tab.close") {
      const workspaceKey = buildWorkspaceTabPersistenceKey({
        serverId: command.serverId,
        workspaceId: command.workspaceId,
      });
      if (!workspaceKey) {
        return;
      }
      useWorkspaceLayoutStore.getState().closeTabByTarget(workspaceKey, command.target);
      return;
    }

    // A page target creates its browser on this device the first time; afterwards the user's
    // own navigation in that tab is kept.
    if (command.target.kind === "browser" && command.browserUrl) {
      useBrowserStore.getState().ensureBrowser(command.target.browserId, command.browserUrl);
    }

    // Beside the user's view, on every attached client: no navigation, no focus change.
    if (command.placement === "side") {
      const workspaceKey = buildWorkspaceTabPersistenceKey({
        serverId: command.serverId,
        workspaceId: command.workspaceId,
      });
      if (workspaceKey) {
        showWorkspaceTargetBeside({ workspaceKey, target: command.target, isCompact });
      }
      return;
    }

    if (!command.focus) {
      const workspaceKey = buildWorkspaceTabPersistenceKey({
        serverId: command.serverId,
        workspaceId: command.workspaceId,
      });
      if (!workspaceKey) {
        return;
      }
      useWorkspaceLayoutStore.getState().openTab({
        workspaceKey,
        target: command.target,
        intent: "background",
      });
      return;
    }

    navigateToWorkspace({
      serverId: command.serverId,
      workspaceId: command.workspaceId,
      target: command.target,
    });
  });

  useEffect(() => {
    const flush = () => {
      for (const command of drainUiCommands()) {
        apply(command);
      }
    };
    const unsubscribe = subscribeToUiCommands(flush);
    flush();
    return unsubscribe;
  }, [apply]);

  return null;
}
