import type { CompanionEntry, TimelineAnchor } from "@getpaseo/protocol/companion-stream";
import { ChevronDown, ChevronUp, HelpCircle, X } from "lucide-react-native";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  hasUnhiddenAnswers,
  selectTrackedAnswers,
  trackedAnswersSignature,
  type TrackedAnswer,
  type TrackedAnswerReview,
} from "./answers-model";
import { splitEntryText } from "./entry-labels";

interface TrackedAnswersPaneProps {
  entries: readonly CompanionEntry[];
  onJump: (anchor: TimelineAnchor) => void;
  /** Resolves once the host has durably recorded the review: reviewed is seen, done stops tracking. */
  onSetStatus: (entryId: string, status: TrackedAnswerReview) => Promise<void>;
}

/**
 * Floats over the top of Chat, clear of the composer, listing the asker's tracked questions
 * that still need attention: waiting for an answer, or answered and not yet seen. Entries
 * come from the agent's Stream snapshot; seen state changes only through Mark seen.
 */
export const TrackedAnswersPane = memo(function TrackedAnswersPane({
  entries,
  onJump,
  onSetStatus,
}: TrackedAnswersPaneProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const items = useMemo(() => selectTrackedAnswers(entries), [entries]);
  const [expanded, setExpanded] = useState(!isCompact);
  const [hiddenSignature, setHiddenSignature] = useState<string | null>(null);
  const newCount = items.filter((item) => item.attention === "new_answer").length;
  const waitingCount = items.length - newCount;

  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const toggleState = useMemo(() => ({ expanded }), [expanded]);
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
            accessibilityState={toggleState}
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
                onJump={onJump}
                onSetStatus={onSetStatus}
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
  onJump,
  onSetStatus,
}: {
  item: TrackedAnswer;
  first: boolean;
  onJump: (anchor: TimelineAnchor) => void;
  onSetStatus: (entryId: string, status: TrackedAnswerReview) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { entry, attention } = item;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = splitEntryText(entry.text).headline || entry.text;
  const answer = entry.answer?.trim() ?? "";

  const jumpToQuestion = useCallback(() => {
    if (entry.questionAnchor) onJump(entry.questionAnchor);
  }, [entry.questionAnchor, onJump]);
  const jumpToAnswer = useCallback(() => {
    if (entry.answerAnchor) onJump(entry.answerAnchor);
  }, [entry.answerAnchor, onJump]);
  // An answered row is marked seen; a waiting row can stop being tracked.
  const review: TrackedAnswerReview = attention === "new_answer" ? "reviewed" : "done";
  const saveReview = useCallback(() => {
    setSaving(true);
    setError(null);
    onSetStatus(entry.id, review)
      .catch(() =>
        setError(
          t(
            review === "reviewed"
              ? "agentPanel.stream.answers.markSeenFailed"
              : "agentPanel.stream.answers.stopTrackingFailed",
          ),
        ),
      )
      .finally(() => setSaving(false));
  }, [entry.id, onSetStatus, review, t]);

  return (
    <View style={[styles.row, !first && styles.rowBorder]} testID={`tracked-answer-${entry.id}`}>
      <View style={styles.rowEyebrow}>
        <StatusBadge
          label={t(
            attention === "new_answer"
              ? "agentPanel.stream.answers.newAnswer"
              : "agentPanel.stream.answers.waiting",
          )}
          variant={attention === "new_answer" ? "success" : "muted"}
        />
      </View>
      <Text style={styles.question} numberOfLines={2}>
        {question}
      </Text>
      {answer ? (
        <Text style={styles.answer} numberOfLines={3}>
          {answer}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {entry.questionAnchor ? (
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
        {entry.answerAnchor ? (
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
        <View style={styles.actionsSpacer} />
        <Button
          variant={review === "reviewed" ? "secondary" : "ghost"}
          size="xs"
          onPress={saveReview}
          loading={saving}
          disabled={saving}
          testID={review === "reviewed" ? "tracked-answer-mark-seen" : "tracked-answer-stop"}
        >
          {t(
            review === "reviewed"
              ? "agentPanel.stream.answers.markSeen"
              : "agentPanel.stream.answers.stopTracking",
          )}
        </Button>
      </View>
    </View>
  );
});

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
