import { useCallback } from "react";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";
import { isWeb, getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";
import {
  buildTabLinkRoute,
  buildWorkspaceLinkRoute,
  buildWorkspaceShareUrl,
} from "./workspace-links";

export function useWorkspaceLinks(
  serverId: string,
  workspaceId: string,
  tab: WorkspaceTabDescriptor | null,
) {
  const toast = useToast();
  const { t } = useTranslation();
  const tabRoute = buildTabLinkRoute(serverId, workspaceId, tab);
  const copyRoute = useCallback(
    async (route: string, label: string) => {
      try {
        const link = isWeb
          ? buildWorkspaceShareUrl(route, getIsElectron() ? null : window.location.origin)
          : buildWorkspaceShareUrl(route, null, Linking.resolveScheme({}));
        const copied = await Clipboard.setStringAsync(link);
        if (!copied) throw new Error("Clipboard write failed");
        toast.copied(label);
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [toast, t],
  );
  const onCopyWorkspaceLink = useCallback(() => {
    void copyRoute(
      buildWorkspaceLinkRoute(serverId, workspaceId),
      t("workspace.header.toasts.workspaceLinkCopiedLabel"),
    );
  }, [copyRoute, serverId, workspaceId, t]);
  const onCopyTabLink = useCallback(() => {
    if (tabRoute) void copyRoute(tabRoute, t("workspace.header.toasts.tabLinkCopiedLabel"));
  }, [copyRoute, tabRoute, t]);
  return { canCopyTabLink: tabRoute !== null, onCopyTabLink, onCopyWorkspaceLink };
}
