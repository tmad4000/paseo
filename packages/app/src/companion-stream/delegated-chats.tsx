import React, { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DelegationPulseChip } from "./delegation-pulse-chip";
import type { DelegationTarget } from "./delegation-pulse";
import type { DelegatedChildPulse } from "./use-delegation-pulse";

/** Rows shown before "Show N more"; the rest are one tap away. */
export const DELEGATED_CHATS_VISIBLE = 5;

function shortAgentId(agentId: string): string {
  return agentId.length > 8 ? agentId.slice(0, 8) : agentId;
}

/**
 * Chats this one delegated to that no ask tracks: each child's live state and a link to it. The
 * host labels every agent another agent creates with its parent, so delegated work stays visible
 * in the delegating chat even when its agent never recorded an ask for it.
 */
export const DelegatedChatsList = memo(function DelegatedChatsList({
  items,
  onOpen,
  first = false,
  showHint = false,
  testID = "delegated-chats",
}: {
  items: readonly DelegatedChildPulse[];
  onOpen: (target: DelegationTarget) => void;
  /** Directly under a header that already separates it; no top border. */
  first?: boolean;
  /** Explain where the rows come from (the full Stream view; the pane stays terse). */
  showHint?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const toggle = useCallback(() => setShowAll((value) => !value), []);
  if (items.length === 0) return null;
  const visible = showAll ? items : items.slice(0, DELEGATED_CHATS_VISIBLE);
  const hidden = items.length - visible.length;
  return (
    <View style={[styles.section, !first && styles.sectionBorder]} testID={testID}>
      <Text style={styles.label} accessibilityRole="header">
        {t("agentPanel.stream.answers.delegation.delegatedChatsSection", {
          count: items.length,
        })}
      </Text>
      {showHint ? (
        <Text style={styles.hint}>
          {t("agentPanel.stream.answers.delegation.delegatedChatsHint")}
        </Text>
      ) : null}
      {visible.map((item) => (
        <DelegatedChatRow key={item.child.agentId} item={item} onOpen={onOpen} />
      ))}
      {hidden > 0 || showAll ? (
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          hitSlop={6}
          testID={`${testID}-more`}
        >
          <Text style={styles.more}>
            {showAll
              ? t("agentPanel.stream.answers.delegation.showFewer")
              : t("agentPanel.stream.answers.delegation.showMore", {
                  count: hidden,
                })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const DelegatedChatRow = memo(function DelegatedChatRow({
  item,
  onOpen,
}: {
  item: DelegatedChildPulse;
  onOpen: (target: DelegationTarget) => void;
}) {
  const open = useCallback(() => onOpen(item.target), [item.target, onOpen]);
  const name = item.pulse.title || item.child.title || shortAgentId(item.child.agentId);
  return (
    <View style={styles.row} testID={`delegated-chat-${item.child.agentId}`}>
      <DelegationPulseChip
        pulse={item.pulse}
        name={name}
        onOpen={open}
        testID="delegated-chat-open"
      />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
  },
  sectionBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  label: {
    paddingTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 28,
  },
  more: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
}));
