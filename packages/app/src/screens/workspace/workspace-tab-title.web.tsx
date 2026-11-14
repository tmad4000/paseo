import { useLayoutEffect, useRef, useState } from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { TrailingActionScrim } from "@/components/ui/trailing-action-scrim";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";

// RN Web's single-line Text installs textOverflow: ellipsis and ignores ellipsizeMode.
const clipStyle = { textOverflow: "clip" } as TextStyle;

export function WorkspaceTabTitle({
  title,
  compact,
  backdrop,
  textStyle,
}: {
  title: string;
  compact: boolean;
  backdrop: SurfaceBackdrop;
  textStyle: StyleProp<TextStyle>;
}) {
  const textRef = useRef<Text>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    if (!isWeb) return;
    // This platform module owns the RN Web Text-to-DOM boundary.
    const node = textRef.current as unknown as HTMLElement | null;
    if (!node) return;
    let mounted = true;
    const measure = () => {
      if (mounted) setOverflows(node.scrollWidth > node.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    void document.fonts.ready.then(measure);
    return () => {
      mounted = false;
      observer.disconnect();
    };
  }, [compact, title]);
  return (
    <View
      style={styles.frame}
      testID={compact ? "workspace-tab-title-compact" : "workspace-tab-title-ellipsis"}
    >
      <Text
        testID="workspace-tab-title-text"
        ref={textRef}
        style={[textStyle, compact && clipStyle]}
        selectable={false}
        numberOfLines={1}
      >
        {title}
      </Text>
      {compact && overflows ? (
        <TrailingActionScrim backdrop={backdrop} width={10} testID="workspace-tab-title-fade" />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { flex: 1, minWidth: 0, position: "relative", overflow: "hidden" },
});
