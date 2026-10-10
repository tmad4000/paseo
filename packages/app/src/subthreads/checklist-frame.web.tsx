import { createElement, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ChecklistFrameProps } from "./checklist-frame.types";

const FRAME_STYLE = { border: 0, width: "100%", height: "100%", display: "block" } as const;

/**
 * A page on the app's own origin would be same-origin with Paseo inside the frame, and with
 * scripts allowed it could reach the app and lift its own sandbox. Those are never framed.
 */
export function isSameOriginAsApp(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return true;
  }
}

/**
 * Web and Electron: an iframe. The checklist owns its own state (checkboxes, coordinator notes)
 * in its own origin's storage and server, so it keeps that origin. Pages on the app's own
 * origin are refused above, so the frame is always cross-origin to Paseo. The sandbox
 * withholds top navigation.
 */
export function ChecklistFrame({ url, title, reloadKey }: ChecklistFrameProps): ReactElement {
  const { t } = useTranslation();
  if (isSameOriginAsApp(url)) {
    return (
      <View style={styles.refused} testID="session-checklist-refused">
        <Text style={styles.refusedText}>{t("sidePanel.sameOriginRefused")}</Text>
      </View>
    );
  }
  return createElement("iframe", {
    key: `${url}#${reloadKey}`,
    src: url,
    title,
    style: FRAME_STYLE,
    // oxlint-disable-next-line react/iframe-missing-sandbox -- never same-origin with the app; see above.
    sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
    referrerPolicy: "no-referrer",
    "data-testid": "session-checklist-frame",
  });
}

const styles = StyleSheet.create((theme) => ({
  refused: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  refusedText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
