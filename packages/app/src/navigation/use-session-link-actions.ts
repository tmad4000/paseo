import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useToast } from "@/contexts/toast-api-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { canOpenSessionWindow, openSessionLink } from "./session-link-runtime";
import { SessionLinkError, type SessionLinkDisposition } from "./session-link";

export function useSessionLinkActions() {
  const toast = useToast();
  const { t } = useTranslation();
  const selection = useActiveWorkspaceSelection();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const open = useStableEvent((href: string, disposition: SessionLinkDisposition = "current") => {
    void openSessionLink(href, disposition, () => selectionRef.current).catch((error: unknown) => {
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
