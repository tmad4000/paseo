import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useBrowserStore } from "@/desktop/browser/store";
import {
  openBrowserPageExternally,
  resolveExternalBrowserPageUrl,
} from "@/desktop/browser/open-external";
import {
  buildBrowserTabMenuEntries,
  type WorkspaceTabMenuEntry,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { openExternalUrl } from "@/utils/open-external-url";

/** Tab menu entries for a browser tab; empty for every other tab kind. */
export function useBrowserTabMenuEntries(input: {
  tab: WorkspaceTabDescriptor;
  menuTestIDBase: string;
}): WorkspaceTabMenuEntry[] {
  const { t } = useTranslation();
  const toast = useToast();
  const { tab, menuTestIDBase } = input;
  const browserId = tab.target.kind === "browser" ? tab.target.browserId : null;
  const canOpen = useBrowserStore((state) =>
    browserId ? resolveExternalBrowserPageUrl(state.browsersById[browserId]?.url) !== null : false,
  );

  const handleOpen = useCallback(
    (id: string) => {
      void openBrowserPageExternally({
        url: useBrowserStore.getState().browsersById[id]?.url,
        open: openExternalUrl,
      }).then((result) => {
        if (result === "unsupported") {
          toast.error(t("workspace.browser.controls.openInBrowserUnsupported"));
        } else if (result === "failed") {
          toast.error(t("workspace.browser.controls.openInBrowserFailed"));
        }
        return undefined;
      });
    },
    [t, toast],
  );

  return useMemo(
    () =>
      buildBrowserTabMenuEntries({
        tab,
        canOpen,
        label: t("workspace.browser.controls.openInBrowser"),
        menuTestIDBase,
        onOpen: handleOpen,
      }),
    [canOpen, handleOpen, menuTestIDBase, t, tab],
  );
}
