import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { useOptionalPaneContext } from "@/panels/pane-context";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useToast } from "@/contexts/toast-api-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { canOpenSessionWindow, openSessionLink } from "./session-link-runtime";
import { SessionLinkError, type SessionLinkDisposition } from "./session-link";

export function useSessionLinkActions() {
  const toast = useToast();
  const { t } = useTranslation();
  const selection = useActiveWorkspaceSelection();
  const pane = useOptionalPaneContext();
  const origin =
    pane &&
    selection &&
    pane.serverId === selection.serverId &&
    (pane.layoutWorkspaceId ?? pane.workspaceId) === selection.workspaceId
      ? { ...selection, tabId: pane.tabId }
      : null;
  const originRef = useRef(origin);
  originRef.current = origin;
  const open = useStableEvent((href: string, disposition: SessionLinkDisposition = "current") => {
    void openSessionLink(href, disposition, () => originRef.current).catch((error: unknown) => {
      const reason = error instanceof SessionLinkError ? error.reason : "unavailable";
      toast.error(t(`sessionLinks.errors.${reason}`));
    });
  });
  const copy = useStableEvent((href: string) => {
    void Clipboard.setStringAsync(href).then(
      () => toast.copied(),
      () => toast.error(t("sessionLinks.errors.copy")),
    );
  });
  return { open, copy, canOpenWindow: canOpenSessionWindow() };
}
