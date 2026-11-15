import { cloneElement, useMemo, type ReactElement, type ReactNode } from "react";
import { measurePress } from "@/performance/response-monitor";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

/**
 * Hover tooltip for an icon-only control or a status glyph: a bare icon says nothing on its own,
 * so every one names what it does. Desktop only, like every `Tooltip`; touch layouts are unchanged.
 *
 * By default the child is wrapped in a plain View that becomes the hover target, which works for
 * Pressables, menu triggers and plain glyphs alike. Pass `wrap={false}` when the child must stay
 * the direct layout child (absolutely positioned or flex-sized): it then has to accept hover
 * handlers and a ref, as a Pressable does.
 */
export function IconTooltip({
  label,
  children,
  side = "top",
  align = "center",
  offset = 6,
  disabled = false,
  wrap = true,
  testID,
}: {
  label: string | null | undefined;
  children: ReactElement;
  side?: Side;
  align?: Align;
  offset?: number;
  /** Suppress the tooltip, e.g. while the control's own menu is open. */
  disabled?: boolean;
  wrap?: boolean;
  testID?: string;
}): ReactNode {
  // The hover/ref wrapper is a View; instrument the action it contains, not that View.
  const action = useMemo(() => {
    const child = children as ReactElement<{ onPress?: (...args: unknown[]) => unknown }>;
    const onPress = child.props.onPress;
    if (typeof onPress !== "function") return children;
    return cloneElement(child, {
      onPress: (...args: unknown[]) => measurePress("tooltip", () => onPress(...args)),
    });
  }, [children]);
  if (!label) return action;
  return (
    <Tooltip delayDuration={300} enabledOnDesktop={!disabled}>
      <TooltipTrigger asChild>
        {wrap ? <View collapsable={false}>{action}</View> : action}
      </TooltipTrigger>
      <TooltipContent side={side} align={align} offset={offset} testID={testID}>
        <Text style={styles.text}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
