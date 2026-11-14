import {
  Children,
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactNode,
  type MouseEvent,
} from "react";
import { Text, type TextProps, type GestureResponderEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { createMarkdownParser } from "@/utils/markdown-parser";
import { isHttpUrl } from "@/utils/http-url";
import { openExternalUrl } from "@/utils/open-external-url";

// Only explicit HTTP(S) URLs: filenames and code such as package.json must stay text.
const linkifier = createMarkdownParser({ linkify: true }).linkify.set({
  fuzzyLink: false,
  fuzzyEmail: false,
  fuzzyIP: false,
});

function openLink(url: string) {
  void openExternalUrl(url).catch(console.error);
}

const WEB_LINK_STYLE: CSSProperties = { color: "inherit", textDecoration: "underline" };

export function SelectableTextLink({ href, children }: { href: string; children: ReactNode }) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const selection = window.getSelection();
      if (
        event.detail > 0 &&
        selection &&
        !selection.isCollapsed &&
        selection.rangeCount > 0 &&
        selection.getRangeAt(0).intersectsNode(event.currentTarget)
      )
        return;
      openLink(href);
    },
    [href],
  );
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      openLink(href);
    },
    [href],
  );

  if (!isHttpUrl(href)) return children;
  return isWeb ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      style={WEB_LINK_STYLE}
    >
      {children}
    </a>
  ) : (
    <Text selectable accessibilityRole="link" style={styles.link} onPress={handlePress}>
      {children}
    </Text>
  );
}

export function linkifyLiteralText(text: string): ReactNode {
  const matches = linkifier.match(text)?.filter((match) => isHttpUrl(match.url));
  if (!matches?.length) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    parts.push(text.slice(cursor, match.index));
    parts.push(
      <SelectableTextLink key={match.index} href={match.url}>
        {match.raw}
      </SelectableTextLink>,
    );
    cursor = match.lastIndex;
  }
  parts.push(text.slice(cursor));
  return parts;
}

/** Plain text stays literal and copyable, including URLs inside commands or JSON. */
export function SelectableLinkText({ children, ...props }: TextProps) {
  const content = useMemo(
    () =>
      Children.map(children, (child) =>
        typeof child === "string" ? linkifyLiteralText(child) : child,
      ),
    [children],
  );
  return (
    <Text {...props} selectable>
      {content}
    </Text>
  );
}

const styles = StyleSheet.create({ link: { textDecorationLine: "underline" } });
