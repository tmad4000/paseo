import { useEffect } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useStableEvent } from "@/hooks/use-stable-event";
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
