import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { History, Link2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useMenuContext } from "@/components/ui/menu";
import { ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import type { Theme } from "@/styles/theme";
import { formatTimeAgo } from "@/utils/time";
import { groupChatLinks, linkHost, type ChatLink, type ChatLinkOrigin } from "./model";
import { LinkPeek, type LinkPeekActions } from "./peek";

const ThemedLink = withUnistyles(Link2);
const ThemedHistory = withUnistyles(History);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const PILL_ICON_SIZE = 12;
const ROW_ICON_SIZE = 14;
const COPIED_FEEDBACK_MS = 1_500;

export type ChatLinkActions = LinkPeekActions;

export interface ChatLinksHistory {
  /** The client holds a partial history, so the list cannot claim to be complete. */
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => void;
}

const SECTION_LABELS = {
  produced: "agentPanel.links.producedSection",
  agent: "agentPanel.links.agentSection",
  you: "agentPanel.links.youSection",
} as const satisfies Record<ChatLinkOrigin, string>;

const ORIGIN_LABELS = {
  produced: "agentPanel.links.originProduced",
  agent: "agentPanel.links.originAgent",
  you: "agentPanel.links.originYou",
} as const satisfies Record<ChatLinkOrigin, string>;

/**
 * Every link in the chat, one tap from the composer: what the chat produced (a mock, a PR), what
 * the agent mentioned, and what you shared. A row peeks the page without leaving the chat.
 * Renders nothing until the chat has a link.
 */
export const ChatLinksTrack = memo(function ChatLinksTrack({
  links,
  actions,
  history,
}: {
  links: readonly ChatLink[];
  actions: ChatLinkActions;
  history?: ChatLinksHistory | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const [peeked, setPeeked] = useState<ChatLink | null>(null);
  const sections = useMemo(() => groupChatLinks(links), [links]);
  const closePeek = useCallback(() => setPeeked(null), []);
  const segments = useMemo(
    () => [
      {
        bucket: null,
        text: t("agentPanel.links.pill", { count: links.length }),
        icon: <ThemedLink size={PILL_ICON_SIZE} uniProps={mutedColorMapping} />,
      },
    ],
    [links.length, t],
  );

  if (links.length === 0) return null;

  const showSectionLabels = sections.length > 1;
  return (
    <>
      <ComposerTrackPill
        testID="chat-links-track-header"
        segments={segments}
        accessibilityLabel={t("agentPanel.links.pillLabel", { count: links.length })}
        panelTitle={t("agentPanel.links.title")}
      >
        {sections.map((section, sectionIndex) => (
          <View key={section.origin} testID={`chat-links-section-${section.origin}`}>
            {showSectionLabels ? (
              <Text
                style={sectionIndex === 0 ? styles.sectionLabel : styles.sectionLabelDivided}
                accessibilityRole="header"
              >
                {t(SECTION_LABELS[section.origin], { count: section.links.length })}
              </Text>
            ) : null}
            {section.links.map((link) => (
              <ChatLinkRow key={link.key} link={link} actions={actions} onPeek={setPeeked} />
            ))}
          </View>
        ))}
        {history?.hasOlder ? <PartialHistoryRow history={history} /> : null}
      </ComposerTrackPill>
      <LinkPeek link={peeked} actions={actions} onClose={closePeek} />
    </>
  );
});

/**
 * The client only sees the history it has loaded, so the list says so instead of implying it is
 * complete, and offers the same history-start pagination the transcript uses.
 */
function PartialHistoryRow({ history }: { history: ChatLinksHistory }): ReactElement {
  const { t } = useTranslation();
  const { loadOlder, isLoadingOlder } = history;
  const renderRow = useCallback(
    ({ active }: { active: boolean }) => (
      <>
        <ThemedHistory
          size={ROW_ICON_SIZE}
          uniProps={active ? foregroundColorMapping : mutedColorMapping}
        />
        <Text style={styles.footerLabel} numberOfLines={1}>
          {t("agentPanel.links.partialHistory")}
        </Text>
        <Text style={styles.footerAction} numberOfLines={1}>
          {t(isLoadingOlder ? "agentPanel.links.loadingEarlier" : "agentPanel.links.loadEarlier")}
        </Text>
      </>
    ),
    [isLoadingOlder, t],
  );
  return (
    <ComposerTrackRow
      testID="chat-links-load-earlier"
      accessibilityLabel={t("agentPanel.links.loadEarlier")}
      disabled={isLoadingOlder}
      // The newly loaded links land in this panel, so it stays open.
      closeOnSelect={false}
      onPress={loadOlder}
    >
      {renderRow}
    </ComposerTrackRow>
  );
}

const ChatLinkRow = memo(function ChatLinkRow({
  link,
  actions,
  onPeek,
}: {
  link: ChatLink;
  actions: ChatLinkActions;
  onPeek: (link: ChatLink) => void;
}): ReactElement {
  const { t } = useTranslation();
  const peek = useCallback(() => onPeek(link), [link, onPeek]);
  const host = linkHost(link.url);
  const time = link.firstSeen.timestamp ? formatTimeAgo(link.firstSeen.timestamp) : null;
  const renderRow = useCallback(
    () => (
      <>
        <View style={styles.rowContent}>
          <Text style={styles.eyebrow} numberOfLines={1}>
            {time ? `${t(ORIGIN_LABELS[link.origin])} · ${time}` : t(ORIGIN_LABELS[link.origin])}
          </Text>
          <Text style={styles.label} numberOfLines={1}>
            {link.label}
          </Text>
          {link.context ? (
            <Text style={styles.context} numberOfLines={1}>
              {link.context}
            </Text>
          ) : null}
          <ChatLinkRowActions link={link} actions={actions} onPeek={peek} />
        </View>
        <Text style={styles.host} numberOfLines={1}>
          {host}
        </Text>
      </>
    ),
    [actions, host, link, peek, t, time],
  );
  return (
    <ComposerTrackRow
      testID={`chat-link-row-${link.key}`}
      accessibilityLabel={t("agentPanel.links.peekLabel", { label: link.label })}
      onPress={peek}
    >
      {renderRow}
    </ComposerTrackRow>
  );
});

/** Peek, Open, Copy, Jump. Open and Jump leave the panel; Copy keeps it and says so. */
function ChatLinkRowActions({
  link,
  actions,
  onPeek,
}: {
  link: ChatLink;
  actions: ChatLinkActions;
  onPeek: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { selectItem } = useMenuContext("ChatLinkRowActions");
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );
  const peek = useCallback(() => selectItem(onPeek, true), [onPeek, selectItem]);
  const open = useCallback(
    () => selectItem(() => actions.open(link), true),
    [actions, link, selectItem],
  );
  const jump = useCallback(
    () => selectItem(() => actions.jump(link), true),
    [actions, link, selectItem],
  );
  const copy = useCallback(() => {
    actions.copy(link);
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, [actions, link]);
  const canJump = actions.canJump(link);

  return (
    <View style={styles.actions}>
      <Button variant="ghost" size="xs" onPress={peek} testID="chat-link-peek">
        {t("agentPanel.links.peek")}
      </Button>
      <Button variant="ghost" size="xs" onPress={open} testID="chat-link-open">
        {t("agentPanel.links.open")}
      </Button>
      <Button variant="ghost" size="xs" onPress={copy} testID="chat-link-copy">
        {t(copied ? "agentPanel.links.copied" : "agentPanel.links.copy")}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onPress={jump}
        disabled={!canJump}
        accessibilityLabel={t("agentPanel.links.jumpLabel")}
        testID="chat-link-jump"
      >
        {t("agentPanel.links.jump")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Basis `auto`, not `flex: 1`: the panel measures itself from its rows (see subagents/track).
  rowContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    gap: 2,
    paddingTop: theme.spacing[1],
  },
  eyebrow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  context: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // Shrinks first, so a long tailnet host gives way before the label does.
  host: {
    flexShrink: 2,
    minWidth: 0,
    maxWidth: 180,
    alignSelf: "flex-start",
    paddingTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: -theme.spacing[2],
  },
  sectionLabel: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sectionLabelDivided: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    marginTop: theme.spacing[1],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.borderAccent,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  footerLabel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  footerAction: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
