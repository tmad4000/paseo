import type { AppDeepLinkTarget } from "@getpaseo/protocol/app-deep-link";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { parseWorkspaceOpenIntent, decodeWorkspaceIdFromPathSegment } from "@/utils/host-routes";
import { useEffect } from "react";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { getDesktopHost } from "@/desktop/host";
import { useStableEvent } from "@/hooks/use-stable-event";
import { navigateToAgent } from "@/utils/navigate-to-agent";

export function AgentNavigationListener() {
  const openAgent = useStableEvent((payload: AppDeepLinkTarget | null) => {
    if (!payload) return;
    // The main process validates OS links before delivering or queuing this target.
    const target = payload;
    if ("agentId" in target) {
      navigateToAgent(target);
      return;
    }
    const workspaceId = decodeWorkspaceIdFromPathSegment(target.workspaceId);
    if (!workspaceId) return;
    navigateToWorkspace({
      serverId: target.serverId,
      workspaceId,
      target: parseWorkspaceOpenIntent(target.open) ?? undefined,
    });
  });

  useEffect(() => {
    const host = getDesktopHost();
    const ready = host?.agentNavigation?.ready;
    if (typeof host?.events?.on !== "function" || typeof ready !== "function") {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      let dispose: (() => void) | null = null;
      try {
        dispose = await listenToDesktopEvent<AppDeepLinkTarget>("open-agent", openAgent);
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
        const pending = await ready();
        if (!disposed && pending) {
          openAgent(pending);
        }
      } catch {
        dispose?.();
        if (unlisten === dispose) {
          unlisten = null;
        }
        if (!disposed) {
          retryTimer = setTimeout(() => void connect(), 1_000);
        }
      }
    };

    void connect();

    return () => {
      disposed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      unlisten?.();
    };
  }, [openAgent]);

  return null;
}
