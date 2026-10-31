import { useMemo, type ReactElement } from "react";
import { WebView } from "react-native-webview";
import { PEEK_VIEWPORT } from "./peek-model";
import type { PeekFrameProps } from "./peek-frame.types";

const WEBVIEW_STYLE = { flex: 1, backgroundColor: "white" } as const;
const ORIGIN_WHITELIST = ["http://*", "https://*"];

// Lay the page out at the desktop width and let the WebView scale it to fit, the native
// counterpart of the web peek's scaled iframe.
const DESKTOP_VIEWPORT_SCRIPT = `(function () {
  var meta = document.querySelector('meta[name="viewport"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "viewport"; document.head.appendChild(meta); }
  meta.content = "width=${PEEK_VIEWPORT.width}";
})(); true;`;

/** Native: the page in a WebView, inside the peek sheet. */
export function PeekFrame({ url, title, onLoad, onError }: PeekFrameProps): ReactElement {
  const source = useMemo(() => ({ uri: url }), [url]);
  return (
    <WebView
      source={source}
      accessibilityLabel={title}
      style={WEBVIEW_STYLE}
      testID="chat-link-peek-frame"
      originWhitelist={ORIGIN_WHITELIST}
      injectedJavaScript={DESKTOP_VIEWPORT_SCRIPT}
      scalesPageToFit
      setSupportMultipleWindows={false}
      onLoadEnd={onLoad}
      onError={onError}
      javaScriptEnabled
      domStorageEnabled
    />
  );
}
