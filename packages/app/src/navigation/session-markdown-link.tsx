import { useStableEvent } from "@/hooks/use-stable-event";
import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Platform, type StyleProp, type TextStyle } from "react-native";
import { isWeb } from "@/constants/platform";
import { MarkdownTextSpan } from "@/components/markdown-text";
import { AssistantLinkPressProvider } from "@/assistant-file-links/link-press-context";
import { useSessionLinkActions } from "./use-session-link-actions";

export function SessionMarkdownLink({
  href,
  title,
  style,
  children,
}: {
  href: string;
  title?: string;
  style: StyleProp<TextStyle>;
  children: ReactNode;
}) {
  const actions = useSessionLinkActions();
  const onPress = useStableEvent(() => actions.open(href));
  const linkPress = useMemo(() => ({ onPress, accessibilityRole: "link" as const }), [onPress]);
  const activate = useStableEvent((event: MouseEvent<HTMLAnchorElement>) => {
    if (event.type === "auxclick" && event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    // Cmd/Ctrl/middle click uses the desktop window API; browser clients open beside.
    // Shift explicitly requests a window and reports when that capability is unavailable.
    const alternate = event.metaKey || event.ctrlKey || event.button === 1;
    if (event.shiftKey || (alternate && actions.canOpenWindow)) {
      actions.open(href, "window");
    } else {
      actions.open(href, alternate ? "side" : "current");
    }
  });
  if (isWeb) {
    return (
      <a href={href} title={title} onClick={activate} onAuxClick={activate} style={ANCHOR_STYLE}>
        <MarkdownTextSpan style={style}>{children}</MarkdownTextSpan>
      </a>
    );
  }
  const span = (
    <MarkdownTextSpan style={style} accessibilityRole="link" onPress={onPress}>
      {children}
    </MarkdownTextSpan>
  );
  return Platform.OS === "ios" ? (
    <AssistantLinkPressProvider value={linkPress}>{span}</AssistantLinkPressProvider>
  ) : (
    span
  );
}

const ANCHOR_STYLE: CSSProperties = { color: "inherit", textDecoration: "none" };
