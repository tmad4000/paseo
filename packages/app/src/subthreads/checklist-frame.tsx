import { useCallback, useMemo, type ReactElement } from "react";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { openExternalUrl } from "@/utils/open-external-url";
import type { ChecklistFrameProps } from "./checklist-frame.types";

const WEBVIEW_STYLE = { flex: 1, backgroundColor: "transparent" } as const;
const ORIGIN_WHITELIST = ["http://*", "https://*"];

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Native: the checklist page in a WebView. Navigation stays on the checklist's own host, so
 * the "Linked checklist · host" strip stays true; links elsewhere open in the system browser.
 */
export function ChecklistFrame({ url, title, reloadKey }: ChecklistFrameProps): ReactElement {
  const source = useMemo(() => ({ uri: url }), [url]);
  const checklistHost = useMemo(() => hostOf(url), [url]);
  const handleShouldStart = useCallback(
    (request: WebViewNavigation) => {
      if (checklistHost !== null && hostOf(request.url) === checklistHost) return true;
      if (/^https?:/i.test(request.url)) void openExternalUrl(request.url);
      return false;
    },
    [checklistHost],
  );
  return (
    <WebView
      key={`${url}#${reloadKey}`}
      source={source}
      accessibilityLabel={title}
      style={WEBVIEW_STYLE}
      testID="session-checklist-frame"
      originWhitelist={ORIGIN_WHITELIST}
      onShouldStartLoadWithRequest={handleShouldStart}
      setSupportMultipleWindows={false}
      javaScriptEnabled
      domStorageEnabled
    />
  );
}
