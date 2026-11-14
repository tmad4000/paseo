import { Text, type StyleProp, type TextStyle } from "react-native";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";

export function WorkspaceTabTitle({
  title,
  compact,
  textStyle,
}: {
  title: string;
  compact: boolean;
  backdrop: SurfaceBackdrop;
  textStyle: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={textStyle}
      selectable={false}
      numberOfLines={1}
      ellipsizeMode={compact ? "clip" : "tail"}
    >
      {title}
    </Text>
  );
}
