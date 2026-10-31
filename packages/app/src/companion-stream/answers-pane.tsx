import type { CompanionEntry, TimelineAnchor } from "@getpaseo/protocol/companion-stream";
import { HelpCircle, Minimize2 } from "lucide-react-native";
import type { TFunction } from "i18next";
import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  answersPaneSignature,
  hasUnhiddenPaneItems,
  selectOpenAsks,
  selectTrackedAnswers,
  trackedAnswerLinks,
  type OpenAsk,
  type OpenAskState,
  type TrackedAnswer,
  type TrackedAnswerLinks,
} from "./answers-model";
import { useAnswersPaneStore } from "./answers-pane-store";
import {
  placeEntry,
  segmentRows,
  startOfLocalDay,
  type ChatSessions,
  type PaneSegment,
  type SessionOrigin,
} from "./answers-sessions";
import { splitEntryText } from "./entry-labels";

export interface TrackedAnswerActions {
  jumpToAnchor: (anchor: TimelineAnchor) => void;
  jumpToMessage: (messageId: string) => void;
  openChat: (agentId: string) => void;
  /** Resolve once the host has durably recorded the change. */
  markSeen: (entryId: string, replyRevision: number) => Promise<void>;
  stopTracking: (entryId: string) => Promise<void>;
  /** True when the message is loaded in Chat, so a jump to it can land. */
  hasMessage: (messageId: string) => boolean;
  /** Shows the ask's card in this chat's Stream. */
  openAsk: (entry: CompanionEntry) => void;
}

interface TrackedAnswersPaneProps {
  entries: readonly CompanionEntry[];
  /** The chat showing the pane; answers written from another chat offer to open it. */
  agentId: string;
  actions: TrackedAnswerActions;
  /** Also list the chat's unresolved asks; older hosts keep the questions-only pane. */
  showOpenAsks?: boolean;
  /** A chat's title for an ask's delegated owner, when this client knows it. */
  agentTitle?: (agentId: string) => string | null | undefined;
  /** The chat's sessions, computed from its whole loaded timeline; omitted, no dividers show. */
  sessions?: ChatSessions | null;
}

const BADGES = {
  new_answer: { label: "agentPanel.stream.answers.newAnswer", variant: "success" },
  candidate: { label: "agentPanel.stream.answers.possibleAnswer", variant: "warning" },
  waiting: { label: "agentPanel.stream.answers.waiting", variant: "muted" },
} as const satisfies Record<string, { label: string; variant: StatusBadgeVariant }>;

const ASK_BADGES = {
  blocked: { label: "agentPanel.stream.answers.askBlocked", variant: "warning" },
  in_progress: { label: "agentPanel.stream.answers.askInProgress", variant: "muted" },
  open: { label: "agentPanel.stream.answers.askOpen", variant: "muted" },
} as const satisfies Record<OpenAskState, { label: string; variant: StatusBadgeVariant }>;

const NO_ASKS: OpenAsk[] = [];
const NO_IDS: ReadonlySet<string> = new Set();

type PaneRow<T> = { type: "divider"; segment: PaneSegment } | { type: "item"; item: T };

/** Rows for one section: under session dividers when the pane spans more than one segment. */
function sectionRows<T extends { entry: CompanionEntry }>(
  items: readonly T[],
  placement: ReadonlyMap<string, PaneSegment> | null,
): PaneRow<T>[] {
  if (!placement) return items.map((item) => ({ type: "item", item }));
  return segmentRows(items, (item) => placement.get(item.entry.id)!);
}

/**
 * Floats over the top of Chat, clear of the composer, listing questions the user asked that
 * need attention: an answer or possible answer not yet seen, or a question still waiting.
 * Entries come from the chat's Stream snapshot (tracked asks and tracked Q&A messages); seen
 * state changes only through Mark seen, per answer revision. Capable hosts also get the chat's
 * other unresolved asks below the questions, blocked first, each with its owner and next step.
 *
 * The pane never disappears while it has items: it minimizes to a small pill at the right
 * edge showing the count, which lights up when an answer arrives or an ask becomes blocked
 * after it was minimized. Phones start minimized; the choice is remembered across chats.
 *
 * When its items span more than one session or day of the chat, each section groups them
 * under dividers, newest first. Rows stay keyed siblings and expanded answers and the scroll
 * position live here, so regrouping, minimizing and reopening keep the reader's place.
 */
export const TrackedAnswersPane = memo(function TrackedAnswersPane({
  entries,
  agentId,
  actions,
  showOpenAsks = false,
  agentTitle,
  sessions,
}: TrackedAnswersPaneProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const items = useMemo(() => selectTrackedAnswers(entries), [entries]);
  const asks = useMemo(
    () =>
      showOpenAsks ? selectOpenAsks(entries, new Set(items.map((item) => item.entry.id))) : NO_ASKS,
    [entries, items, showOpenAsks],
  );
  const minimized = useAnswersPaneStore((state) => state.minimized) ?? isCompact;
  const setMinimized = useAnswersPaneStore((state) => state.setMinimized);
  // What was showing when the person minimized; later answers and blocks light up the pill.
  const [minimizedSignature, setMinimizedSignature] = useState<string | null>(null);
  const [expandedAnswers, setExpandedAnswers] = useState<ReadonlySet<string>>(NO_IDS);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const scrollRestored = useRef(false);
  const waitingCount = items.filter((item) => item.attention === "waiting").length;
  const newCount = items.length - waitingCount;
  const blockedCount = asks.filter((item) => item.state === "blocked").length;

  const placement = useMemo(() => {
    if (!sessions) return null;
    const byId = new Map<string, PaneSegment>();
    for (const { entry } of [...items, ...asks]) byId.set(entry.id, placeEntry(entry, sessions));
    // One segment needs no divider: everything happened in the same session and day.
    return new Set([...byId.values()].map((segment) => segment.key)).size > 1 ? byId : null;
  }, [asks, items, sessions]);

  const minimize = useCallback(() => {
    setMinimizedSignature(answersPaneSignature(items, asks));
    scrollRestored.current = false;
    setMinimized(true);
  }, [asks, items, setMinimized]);
  const expand = useCallback(() => setMinimized(false), [setMinimized]);
  const toggleAnswer = useCallback((entryId: string) => {
    setExpandedAnswers((current) => {
      const next = new Set(current);
      if (!next.delete(entryId)) next.add(entryId);
      return next;
    });
  }, []);
  const rememberScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);
  // Reopening lands where the reader left off rather than back at the top.
  const restoreScroll = useCallback(() => {
    if (scrollRestored.current) return;
    scrollRestored.current = true;
    if (scrollY.current > 0) scrollRef.current?.scrollTo({ y: scrollY.current, animated: false });
  }, []);

  const total = items.length + asks.length;
  if (total === 0) return null;

  const summary = [
    newCount > 0 ? t("agentPanel.stream.answers.newCount", { count: newCount }) : null,
    waitingCount > 0 ? t("agentPanel.stream.answers.waitingCount", { count: waitingCount }) : null,
    asks.length > 0 ? t("agentPanel.stream.answers.openAsksCount", { count: asks.length }) : null,
    blockedCount > 0 ? t("agentPanel.stream.answers.blockedCount", { count: blockedCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = t(
    asks.length > 0 ? "agentPanel.stream.answers.titleWithAsks" : "agentPanel.stream.answers.title",
  );

  if (minimized) {
    const attention =
      minimizedSignature === null
        ? newCount + blockedCount > 0
        : hasUnhiddenPaneItems(items, asks, minimizedSignature);
    return (
      <View
        style={[styles.anchor, isCompact && styles.anchorCompact]}
        pointerEvents="box-none"
        testID="tracked-answers-pane"
      >
        <PaneTooltip label={t("agentPanel.stream.answers.expandTip", { summary })}>
          <Pressable
            onPress={expand}
            style={[styles.pill, attention && styles.pillAttention]}
            accessibilityRole="button"
            aria-expanded={false}
            accessibilityLabel={`${t("agentPanel.stream.answers.expand")}. ${summary}`}
            hitSlop={6}
            testID="tracked-answers-expand"
          >
            <HelpCircle size={14} color={attention ? styles.iconNew.color : styles.icon.color} />
            <Text style={[styles.pillCount, attention && styles.pillCountAttention]}>{total}</Text>
          </Pressable>
        </PaneTooltip>
      </View>
    );
  }

  const questionRows = sectionRows(items, placement);
  const askRows = sectionRows(asks, placement);

  return (
    <View
      style={[styles.anchor, isCompact && styles.anchorCompact]}
      pointerEvents="box-none"
      testID="tracked-answers-pane"
    >
      <View style={styles.card}>
        <PaneTooltip label={t("agentPanel.stream.answers.minimizeTip")}>
          <Pressable
            onPress={minimize}
            style={styles.header}
            accessibilityRole="button"
            aria-expanded
            accessibilityLabel={`${t("agentPanel.stream.answers.minimize")}. ${summary}`}
            accessibilityHint={t("agentPanel.stream.answers.minimizeTip")}
            testID="tracked-answers-minimize"
          >
            <HelpCircle size={14} color={newCount > 0 ? styles.iconNew.color : styles.icon.color} />
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.summary} numberOfLines={1} accessibilityLiveRegion="polite">
              {summary}
            </Text>
            <Minimize2 size={14} color={styles.icon.color} />
          </Pressable>
        </PaneTooltip>
        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          onScroll={rememberScroll}
          scrollEventThrottle={64}
          onContentSizeChange={restoreScroll}
        >
          {items.length > 0 && asks.length > 0 ? (
            <SectionLabel
              label={t("agentPanel.stream.answers.questionsSection", { count: items.length })}
              first
            />
          ) : null}
          {questionRows.map((row, index) =>
            row.type === "divider" ? (
              <SessionDivider
                key={`divider:q:${row.segment.key}`}
                segment={row.segment}
                first={index === 0}
              />
            ) : (
              <TrackedAnswerRow
                key={row.item.entry.id}
                item={row.item}
                first={index === 0 || questionRows[index - 1]!.type === "divider"}
                agentId={agentId}
                actions={actions}
                answerExpanded={expandedAnswers.has(row.item.entry.id)}
                onToggleAnswer={toggleAnswer}
              />
            ),
          )}
          {asks.length > 0 ? (
            <View testID="open-asks-section">
              <SectionLabel
                label={t("agentPanel.stream.answers.openAsksSection", { count: asks.length })}
                first={items.length === 0}
              />
              {askRows.map((row, index) =>
                row.type === "divider" ? (
                  <SessionDivider
                    key={`divider:a:${row.segment.key}`}
                    segment={row.segment}
                    first={index === 0}
                  />
                ) : (
                  <OpenAskRow
                    key={row.item.entry.id}
                    item={row.item}
                    first={index === 0 || askRows[index - 1]!.type === "divider"}
                    ownerTitle={
                      row.item.delegatedAgentId
                        ? agentTitle?.(row.item.delegatedAgentId)
                        : undefined
                    }
                    actions={actions}
                  />
                ),
              )}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
});

/**
 * A fast, desktop-only explanation of a pane control. Every control also carries its label and
 * hint for assistive tech, and nothing essential lives only in the tooltip: phones show the
 * same controls as plain visible buttons.
 */
function PaneTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" align="center" offset={6}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const MINUTE = 60 * 1000;

function formatIdle(ms: number, t: TFunction): string {
  const minutes = Math.round(ms / MINUTE);
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) {
    return t("agentPanel.stream.answers.sessions.durationDays", { count: Math.floor(hours / 24) });
  }
  if (hours === 0)
    return t("agentPanel.stream.answers.sessions.durationMinutes", { count: minutes });
  const rest = minutes - hours * 60;
  return rest === 0
    ? t("agentPanel.stream.answers.sessions.durationHours", { count: hours })
    : t("agentPanel.stream.answers.sessions.durationHoursMinutes", { hours, minutes: rest });
}

function formatDay(time: number, t: TFunction, language: string, now: Date): string {
  const today = startOfLocalDay(now.getTime());
  const day = startOfLocalDay(time);
  if (day === today) return t("agentPanel.stream.answers.sessions.today");
  if (day === startOfLocalDay(today - 1)) return t("agentPanel.stream.answers.sessions.yesterday");
  const date = new Date(time);
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

function formatTime(time: number, language: string): string {
  return new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }).format(
    new Date(time),
  );
}

/** A divider's visible title, its muted detail, and the full sentence for assistive tech. */
export function describeSegment(
  segment: PaneSegment,
  t: TFunction,
  language: string,
  now: Date = new Date(),
): { title: string; detail: string | null } {
  const key = "agentPanel.stream.answers.sessions";
  switch (segment.kind) {
    case "unknown":
      return { title: t(`${key}.unknownTime`), detail: null };
    case "inherited":
      return { title: t(`${key}.inherited`), detail: t(`${key}.beforeFork`) };
    case "earlier":
      return { title: formatDay(segment.time!, t, language, now), detail: t(`${key}.earlier`) };
    case "day":
      return { title: formatDay(segment.time!, t, language, now), detail: t(`${key}.continues`) };
    case "session": {
      const session = segment.session!;
      const title = t(`${key}.sessionTitle`, {
        day: formatDay(session.start, t, language, now),
        time: formatTime(session.start, language),
      });
      const details: Record<SessionOrigin, string> = {
        start: t(`${key}.chatStarts`),
        idle: t(`${key}.afterIdle`, { duration: formatIdle(session.idleMs ?? 0, t) }),
        fork: t(`${key}.forkStarts`),
        partial: t(`${key}.partialStart`),
      };
      return { title, detail: details[session.origin] };
    }
  }
}

const SessionDivider = memo(function SessionDivider({
  segment,
  first,
}: {
  segment: PaneSegment;
  /** Directly under its section label, which already separates it. */
  first: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { title, detail } = describeSegment(segment, t, i18n.language);
  return (
    <View
      style={[styles.divider, !first && styles.dividerBorder]}
      accessibilityRole="header"
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      testID={`session-divider-${segment.kind}`}
    >
      <Text style={styles.dividerTitle} numberOfLines={1}>
        {title}
      </Text>
      {detail ? <Text style={styles.dividerDetail}>{detail}</Text> : null}
    </View>
  );
});

function SectionLabel({ label, first }: { label: string; first?: boolean }) {
  return (
    <Text
      style={[styles.sectionLabel, !first && styles.sectionLabelBorder]}
      accessibilityRole="header"
    >
      {label}
    </Text>
  );
}

/** A short, stable stand-in for a chat this client has no title for. */
function shortAgentId(agentId: string): string {
  return agentId.slice(0, 8);
}

/**
 * One unresolved ask: state and owner as a muted eyebrow, the ask itself as the headline, and
 * its next step. Tapping jumps to the source message when Chat has it, else opens the ask card.
 */
const OpenAskRow = memo(function OpenAskRow({
  item,
  first,
  ownerTitle,
  actions,
}: {
  item: OpenAsk;
  first: boolean;
  ownerTitle: string | null | undefined;
  actions: TrackedAnswerActions;
}) {
  const { t } = useTranslation();
  const { entry, state, nextAction, delegatedAgentId } = item;
  const headline = splitEntryText(entry.text).headline || entry.text;
  const badge = ASK_BADGES[state];
  const sourceMessageId = entry.ask?.sourceMessageId;
  const open = useCallback(() => {
    if (sourceMessageId && actions.hasMessage(sourceMessageId)) {
      actions.jumpToMessage(sourceMessageId);
    } else {
      actions.openAsk(entry);
    }
  }, [actions, entry, sourceMessageId]);
  const openOwner = useCallback(() => {
    if (delegatedAgentId) actions.openChat(delegatedAgentId);
  }, [actions, delegatedAgentId]);
  const owner = delegatedAgentId ? ownerTitle?.trim() || shortAgentId(delegatedAgentId) : null;

  return (
    <View style={[styles.row, !first && styles.rowBorder]} testID={`open-ask-${entry.id}`}>
      <View style={styles.askEyebrow}>
        <StatusBadge label={t(badge.label)} variant={badge.variant} />
        {owner ? (
          <PaneTooltip label={t("agentPanel.stream.answers.openOwnerLabel", { name: owner })}>
            <Pressable
              onPress={openOwner}
              style={styles.ownerLink}
              accessibilityRole="link"
              accessibilityLabel={t("agentPanel.stream.answers.openOwnerLabel", { name: owner })}
              hitSlop={6}
              testID="open-ask-owner"
            >
              <Text style={styles.owner} numberOfLines={1}>
                {owner}
              </Text>
            </Pressable>
          </PaneTooltip>
        ) : null}
      </View>
      <PaneTooltip label={t("agentPanel.stream.answers.openAskHint")}>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={headline}
          accessibilityHint={t("agentPanel.stream.answers.openAskHint")}
          testID="open-ask-open"
        >
          <Text style={styles.question} numberOfLines={2}>
            {headline}
          </Text>
          {nextAction ? (
            <Text style={styles.nextAction} numberOfLines={2}>
              {t("agentPanel.stream.answers.nextAction", { action: nextAction })}
            </Text>
          ) : null}
        </Pressable>
      </PaneTooltip>
    </View>
  );
});

const TrackedAnswerRow = memo(function TrackedAnswerRow({
  item,
  first,
  agentId,
  actions,
  answerExpanded,
  onToggleAnswer,
}: {
  item: TrackedAnswer;
  first: boolean;
  agentId: string;
  actions: TrackedAnswerActions;
  /** Held by the pane, so an expanded answer stays expanded across regrouping and reopening. */
  answerExpanded: boolean;
  onToggleAnswer: (entryId: string) => void;
}) {
  const { t } = useTranslation();
  const { entry, attention } = item;
  const [error, setError] = useState<string | null>(null);
  const question = splitEntryText(entry.text).headline || entry.text;
  const badge = BADGES[attention];
  const links = useMemo(() => trackedAnswerLinks(entry, agentId), [agentId, entry]);
  const toggleAnswer = useCallback(() => onToggleAnswer(entry.id), [entry.id, onToggleAnswer]);

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
  const saveTip = t(
    reply ? "agentPanel.stream.answers.markSeenTip" : "agentPanel.stream.answers.stopTrackingTip",
  );

  return (
    <View style={styles.actions}>
      {questionAnchor || questionMessageId ? (
        <PaneTooltip label={t("agentPanel.stream.answers.jumpQuestionLabel")}>
          <Button
            variant="ghost"
            size="xs"
            onPress={jumpToQuestion}
            accessibilityLabel={t("agentPanel.stream.answers.jumpQuestionLabel")}
            testID="tracked-answer-jump-question"
          >
            {t("agentPanel.stream.answers.jumpQuestion")}
          </Button>
        </PaneTooltip>
      ) : null}
      {answerAnchor ? (
        <PaneTooltip label={t("agentPanel.stream.answers.jumpAnswerLabel")}>
          <Button
            variant="ghost"
            size="xs"
            onPress={jumpToAnswer}
            accessibilityLabel={t("agentPanel.stream.answers.jumpAnswerLabel")}
            testID="tracked-answer-jump-answer"
          >
            {t("agentPanel.stream.answers.jumpAnswer")}
          </Button>
        </PaneTooltip>
      ) : null}
      {answeringAgentId ? (
        <PaneTooltip label={t("agentPanel.stream.answers.openChatTip")}>
          <Button
            variant="ghost"
            size="xs"
            onPress={openChat}
            accessibilityHint={t("agentPanel.stream.answers.openChatTip")}
            testID="tracked-answer-open-chat"
          >
            {t("agentPanel.stream.answers.openChat")}
          </Button>
        </PaneTooltip>
      ) : null}
      <View style={styles.actionsSpacer} />
      {reply || canStop ? (
        <PaneTooltip label={saveTip}>
          <Button
            variant={reply ? "secondary" : "ghost"}
            size="xs"
            onPress={save}
            loading={saving}
            disabled={saving}
            accessibilityHint={saveTip}
            testID={reply ? "tracked-answer-mark-seen" : "tracked-answer-stop"}
          >
            {t(
              reply
                ? "agentPanel.stream.answers.markSeen"
                : "agentPanel.stream.answers.stopTracking",
            )}
          </Button>
        </PaneTooltip>
      ) : null}
    </View>
  );
}

const PANE_WIDTH = 340;

const styles = StyleSheet.create((theme) => ({
  // Clears the floating Chat/Stream switcher row; the composer sits below this view entirely.
  // Children align right so the minimized pill hugs the edge and the rest of the row stays
  // tappable through the box-none anchor.
  anchor: {
    position: "absolute",
    top: theme.spacing[12],
    right: theme.spacing[3],
    width: PANE_WIDTH,
    maxWidth: "100%",
    maxHeight: "60%",
    zIndex: 15,
    alignItems: "flex-end",
  },
  // The compact switcher uses the taller sm control; the open card spans the chat's width.
  anchorCompact: {
    top: theme.spacing[12] + theme.spacing[2],
    left: theme.spacing[3],
    width: "auto",
    maxHeight: "45%",
  },
  card: {
    alignSelf: "stretch",
    maxHeight: "100%",
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
    ...theme.shadow.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    minHeight: 36,
  },
  // The title stays whole; the muted summary truncates first.
  title: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  summary: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 32,
    paddingHorizontal: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    ...theme.shadow.md,
  },
  pillAttention: {
    borderColor: theme.colors.statusSuccess,
  },
  pillCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  pillCountAttention: {
    color: theme.colors.foreground,
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
  sectionLabel: {
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  // The detail wraps under the title on narrow screens rather than truncating.
  divider: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  dividerBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  dividerTitle: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  dividerDetail: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  sectionLabelBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  askEyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  ownerLink: {
    flexShrink: 1,
    minWidth: 0,
  },
  owner: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
  nextAction: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
}));
