import type { CompanionEntry, TimelineAnchor } from "@getpaseo/protocol/companion-stream";
import { ChevronDown, ChevronUp, HelpCircle, X } from "lucide-react-native";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  hasUnhiddenAnswers,
  selectTrackedAnswers,
  trackedAnswerLinks,
  trackedAnswersSignature,
  type TrackedAnswer,
  type TrackedAnswerLinks,
} from "./answers-model";
import { splitEntryText } from "./entry-labels";

export interface TrackedAnswerActions {
  jumpToAnchor: (anchor: TimelineAnchor) => void;
  jumpToMessage: (messageId: string) => void;
  openChat: (agentId: string) => void;
  /** Resolve once the host has durably recorded the change. */
  markSeen: (entryId: string, replyRevision: number) => Promise<void>;
  stopTracking: (entryId: string) => Promise<void>;
}

interface TrackedAnswersPaneProps {
  entries: readonly CompanionEntry[];
  /** The chat showing the pane; answers written from another chat offer to open it. */
  agentId: string;
  actions: TrackedAnswerActions;
}

const BADGES = {
  new_answer: { label: "agentPanel.stream.answers.newAnswer", variant: "success" },
  candidate: { label: "agentPanel.stream.answers.possibleAnswer", variant: "warning" },
  waiting: { label: "agentPanel.stream.answers.waiting", variant: "muted" },
} as const satisfies Record<string, { label: string; variant: StatusBadgeVariant }>;

/**
 * Floats over the top of Chat, clear of the composer, listing questions the user asked that
 * need attention: an answer or possible answer not yet seen, or a question still waiting.
 * Entries come from the chat's Stream snapshot (tracked asks and tracked Q&A messages); seen
 * state changes only through Mark seen, per answer revision.
 */
export const TrackedAnswersPane = memo(function TrackedAnswersPane({
  entries,
  agentId,
  actions,
}: TrackedAnswersPaneProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const items = useMemo(() => selectTrackedAnswers(entries), [entries]);
  const [expanded, setExpanded] = useState(!isCompact);
  const [hiddenSignature, setHiddenSignature] = useState<string | null>(null);
  const waitingCount = items.filter((item) => item.attention === "waiting").length;
  const newCount = items.length - waitingCount;

  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const hide = useCallback(() => setHiddenSignature(trackedAnswersSignature(items)), [items]);

  if (items.length === 0 || !hasUnhiddenAnswers(items, hiddenSignature)) return null;

  const summary = [
    newCount > 0 ? t("agentPanel.stream.answers.newCount", { count: newCount }) : null,
    waitingCount > 0 ? t("agentPanel.stream.answers.waitingCount", { count: waitingCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      style={[styles.anchor, isCompact && styles.anchorCompact]}
      pointerEvents="box-none"
      testID="tracked-answers-pane"
    >
      <View style={[styles.card, isCompact && expanded && styles.cardCompactExpanded]}>
        <View style={styles.header}>
          <Pressable
            onPress={toggle}
            style={styles.headerToggle}
            accessibilityRole="button"
            aria-expanded={expanded}
            accessibilityLabel={`${t(
              expanded ? "agentPanel.stream.answers.collapse" : "agentPanel.stream.answers.expand",
            )}. ${summary}`}
            testID="tracked-answers-toggle"
          >
            <HelpCircle size={14} color={newCount > 0 ? styles.iconNew.color : styles.icon.color} />
            <Text style={styles.title} numberOfLines={1}>
              {t("agentPanel.stream.answers.title")}
            </Text>
            <Text style={styles.summary} numberOfLines={1} accessibilityLiveRegion="polite">
              {summary}
            </Text>
            {expanded ? (
              <ChevronUp size={14} color={styles.icon.color} />
            ) : (
              <ChevronDown size={14} color={styles.icon.color} />
            )}
          </Pressable>
          <Pressable
            onPress={hide}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t("agentPanel.stream.answers.dismiss")}
            hitSlop={8}
            testID="tracked-answers-dismiss"
          >
            <X size={14} color={styles.icon.color} />
          </Pressable>
        </View>
        {expanded ? (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {items.map((item, index) => (
              <TrackedAnswerRow
                key={item.entry.id}
                item={item}
                first={index === 0}
                agentId={agentId}
                actions={actions}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
});

const TrackedAnswerRow = memo(function TrackedAnswerRow({
  item,
  first,
  agentId,
  actions,
}: {
  item: TrackedAnswer;
  first: boolean;
  agentId: string;
  actions: TrackedAnswerActions;
}) {
  const { t } = useTranslation();
  const { entry, attention } = item;
  const [answerExpanded, setAnswerExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = splitEntryText(entry.text).headline || entry.text;
  const badge = BADGES[attention];
  const links = useMemo(() => trackedAnswerLinks(entry, agentId), [agentId, entry]);
  const toggleAnswer = useCallback(() => setAnswerExpanded((value) => !value), []);

  return (
    <View style={[styles.row, !first && styles.rowBorder]} testID={`tracked-answer-${entry.id}`}>
      <View style={styles.rowEyebrow}>
        <StatusBadge label={t(badge.label)} variant={badge.variant} />
      </View>
      <Text style={styles.question} numberOfLines={2}>
        {question}
      </Text>
      {entry.reply ? (
        <Pressable
          onPress={toggleAnswer}
          accessibilityRole="button"
          aria-expanded={answerExpanded}
          testID="tracked-answer-text"
        >
          <Text style={styles.answer} numberOfLines={answerExpanded ? undefined : 3}>
            {entry.reply.text}
          </Text>
        </Pressable>
      ) : null}
      {attention === "candidate" ? (
        <Text style={styles.hint}>{t("agentPanel.stream.answers.candidateHint")}</Text>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <TrackedAnswerRowActions item={item} links={links} actions={actions} onError={setError} />
    </View>
  );
});

/** Jumps on the left; the one review action (Mark seen, or Stop tracking) on the right. */
function TrackedAnswerRowActions({
  item,
  links,
  actions,
  onError,
}: {
  item: TrackedAnswer;
  links: TrackedAnswerLinks;
  actions: TrackedAnswerActions;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const { entry, attention } = item;
  const [saving, setSaving] = useState(false);
  const reply = entry.reply;
  const canStop = attention === "waiting" && entry.kind === "q_and_a";
  const { questionAnchor, questionMessageId, answerAnchor, answeringAgentId } = links;

  const jumpToQuestion = useCallback(() => {
    if (questionAnchor) actions.jumpToAnchor(questionAnchor);
    else if (questionMessageId) actions.jumpToMessage(questionMessageId);
  }, [actions, questionAnchor, questionMessageId]);
  const jumpToAnswer = useCallback(() => {
    if (answerAnchor) actions.jumpToAnchor(answerAnchor);
  }, [actions, answerAnchor]);
  const openChat = useCallback(() => {
    if (answeringAgentId) actions.openChat(answeringAgentId);
  }, [actions, answeringAgentId]);
  const save = useCallback(() => {
    setSaving(true);
    onError(null);
    const pending = reply
      ? actions.markSeen(entry.id, reply.revision)
      : actions.stopTracking(entry.id);
    pending
      .catch(() =>
        onError(
          t(
            reply
              ? "agentPanel.stream.answers.markSeenFailed"
              : "agentPanel.stream.answers.stopTrackingFailed",
          ),
        ),
      )
      .finally(() => setSaving(false));
  }, [actions, entry.id, onError, reply, t]);

  return (
    <View style={styles.actions}>
      {questionAnchor || questionMessageId ? (
        <Button
          variant="ghost"
          size="xs"
          onPress={jumpToQuestion}
          accessibilityLabel={t("agentPanel.stream.answers.jumpQuestionLabel")}
          testID="tracked-answer-jump-question"
        >
          {t("agentPanel.stream.answers.jumpQuestion")}
        </Button>
      ) : null}
      {answerAnchor ? (
        <Button
          variant="ghost"
          size="xs"
          onPress={jumpToAnswer}
          accessibilityLabel={t("agentPanel.stream.answers.jumpAnswerLabel")}
          testID="tracked-answer-jump-answer"
        >
          {t("agentPanel.stream.answers.jumpAnswer")}
        </Button>
      ) : null}
      {answeringAgentId ? (
        <Button variant="ghost" size="xs" onPress={openChat} testID="tracked-answer-open-chat">
          {t("agentPanel.stream.answers.openChat")}
        </Button>
      ) : null}
      <View style={styles.actionsSpacer} />
      {reply || canStop ? (
        <Button
          variant={reply ? "secondary" : "ghost"}
          size="xs"
          onPress={save}
          loading={saving}
          disabled={saving}
          testID={reply ? "tracked-answer-mark-seen" : "tracked-answer-stop"}
        >
          {t(
            reply ? "agentPanel.stream.answers.markSeen" : "agentPanel.stream.answers.stopTracking",
          )}
        </Button>
      ) : null}
    </View>
  );
}

const PANE_WIDTH = 340;

const styles = StyleSheet.create((theme) => ({
  // Clears the floating Chat/Stream switcher row; the composer sits below this view entirely.
  anchor: {
    position: "absolute",
    top: theme.spacing[12],
    right: theme.spacing[3],
    width: PANE_WIDTH,
    maxWidth: "100%",
    maxHeight: "60%",
    zIndex: 15,
  },
  // The compact switcher uses the taller sm control.
  anchorCompact: {
    top: theme.spacing[12] + theme.spacing[2],
    left: theme.spacing[3],
    width: "auto",
    maxHeight: "45%",
    alignItems: "flex-end",
  },
  card: {
    maxHeight: "100%",
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
    ...theme.shadow.md,
  },
  cardCompactExpanded: {
    alignSelf: "stretch",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    minHeight: 36,
    gap: theme.spacing[1],
  },
  headerToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 36,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  summary: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  iconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  iconNew: {
    color: theme.colors.statusSuccess,
  },
  list: {
    flexGrow: 0,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  listContent: {
    paddingHorizontal: theme.spacing[3],
  },
  row: {
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[1],
  },
  rowBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  rowEyebrow: {
    flexDirection: "row",
  },
  question: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  answer: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
    marginLeft: -theme.spacing[2],
  },
  actionsSpacer: {
    flex: 1,
  },
}));
