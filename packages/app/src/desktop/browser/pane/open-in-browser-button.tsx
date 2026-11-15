import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useBrowserStore } from "@/desktop/browser/store";
import { openExternalUrl } from "@/utils/open-external-url";
import { openBrowserPageExternally, resolveExternalBrowserPageUrl } from "../open-external";

/**
 * Shown where the in-app browser cannot run (plain web, iOS, Android): opens the
 * browser tab's page in the system browser instead. Renders nothing until the tab
 * has an http(s) page.
 */
export function OpenInBrowserButton({ browserId }: { browserId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const url = useBrowserStore((state) =>
    resolveExternalBrowserPageUrl(state.browsersById[browserId]?.url),
  );

  const handlePress = useCallback(() => {
    void openBrowserPageExternally({ url, open: openExternalUrl }).then((result) => {
      if (result === "failed") {
        toast.error(t("workspace.browser.controls.openInBrowserFailed"));
      }
      return undefined;
    });
  }, [t, toast, url]);

  if (!url) {
    return null;
  }
  return (
    <Button
      variant="outline"
      size="sm"
      leftIcon={ExternalLink}
      onPress={handlePress}
      accessibilityLabel={t("workspace.browser.controls.openInBrowser")}
      testID={`browser-open-external-${browserId}`}
    >
      {t("workspace.browser.controls.openInBrowser")}
    </Button>
  );
}
