export { ComposerDockBackground } from "./internal/background";
import { ScrollView } from "@/components/ui/scroll-view";
import { useCallback, useState, type ReactNode } from "react";
import { View, StyleSheet, type LayoutChangeEvent } from "react-native";
import { ComposerPaneHeightContext } from "./pane-height";
import { HEADER_INNER_HEIGHT, MAX_CONTENT_WIDTH } from "@/constants/layout";

interface ComposerDockProps {
  children: [ReactNode, ReactNode, ReactNode?];
  centered?: boolean;
}

export function ComposerDock({
  children: [content, composer, overlay],
  centered = false,
}: ComposerDockProps) {
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    // Retained hidden tabs report zero; keep their last usable geometry.
    if (height > 0) setPaneHeight(height);
  }, []);
  if (centered) {
    return (
      <ComposerPaneHeightContext.Provider value={paneHeight}>
        <View style={styles.centered} onLayout={handleLayout}>
          <View style={styles.form}>
            <ScrollView style={styles.setup} keyboardShouldPersistTaps="handled">
              {content}
            </ScrollView>
            <View style={styles.centeredComposer}>{composer}</View>
            {overlay}
          </View>
        </View>
      </ComposerPaneHeightContext.Provider>
    );
  }
  return (
    <ComposerPaneHeightContext.Provider value={paneHeight}>
      <View style={styles.surface} onLayout={handleLayout}>
        <View style={styles.content}>{content}</View>
        <View style={styles.composer}>{composer}</View>
        {overlay}
      </View>
    </ComposerPaneHeightContext.Provider>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, overflow: "hidden" },
  content: { flex: 1, justifyContent: "flex-end" },
  composer: { width: "100%", flexShrink: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: HEADER_INNER_HEIGHT + 24,
  },
  form: { flexShrink: 1, width: "100%", maxWidth: MAX_CONTENT_WIDTH },
  centeredComposer: { flexShrink: 0 },
  setup: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
});
