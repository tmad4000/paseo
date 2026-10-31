import { createElement, useCallback, useMemo, useState, type ReactElement } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PEEK_VIEWPORT, peekScale } from "./peek-model";
import type { PeekFrameProps } from "./peek-frame.types";

/**
 * Web and Electron: the page in an iframe laid out at a desktop viewport. A static peek scales
 * that viewport to fit and takes no pointer input, so a stray click cannot change the page;
 * Interact shows it at real size with scrolling. Same-origin pages never reach here (see
 * `isSameOriginAsApp`), so the sandbox's allow-same-origin keeps the page's own origin, not ours.
 */
export function PeekFrame({ url, title, interactive, onLoad }: PeekFrameProps): ReactElement {
  const [body, setBody] = useState({ width: 0, height: 0 });
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBody((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    );
  }, []);
  const scale = interactive ? 1 : peekScale(body);
  const scrollerStyle = useMemo(
    () => ({
      position: "absolute",
      inset: 0,
      overflow: interactive ? "auto" : "hidden",
      display: "flex",
      justifyContent: interactive ? "flex-start" : "center",
      alignItems: "flex-start",
    }),
    [interactive],
  );
  const boxStyle = useMemo(
    () => ({
      flex: "none",
      width: PEEK_VIEWPORT.width * scale,
      height: PEEK_VIEWPORT.height * scale,
    }),
    [scale],
  );
  const frameStyle = useMemo(
    () => ({
      border: 0,
      display: "block",
      width: PEEK_VIEWPORT.width,
      height: PEEK_VIEWPORT.height,
      transform: `scale(${scale})`,
      transformOrigin: "0 0",
      pointerEvents: interactive ? "auto" : "none",
      background: "white",
    }),
    [interactive, scale],
  );
  const frame = createElement("iframe", {
    src: url,
    title,
    onLoad,
    style: frameStyle,
    // oxlint-disable-next-line react/iframe-missing-sandbox -- never same-origin with the app; see above.
    sandbox: "allow-scripts allow-same-origin allow-forms allow-popups",
    referrerPolicy: "no-referrer",
    "data-testid": "chat-link-peek-frame",
    "data-scale": scale.toFixed(3),
    "data-interactive": String(interactive),
  });
  return (
    <View style={styles.body} onLayout={handleLayout} testID="chat-link-peek-body">
      {createElement(
        "div",
        { style: scrollerStyle },
        createElement("div", { style: boxStyle }, frame),
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: theme.colors.surface1,
  },
}));
