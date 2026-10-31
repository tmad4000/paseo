import {
  isCompanionEntryPending,
  needsUserInput,
  type CompanionEntry,
} from "@getpaseo/protocol/companion-stream";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { formatMessageTimestamp } from "@/utils/time";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { ChatJumpTarget } from "@/agent-stream/use-timeline-anchor-jump";
import { describeEntry, splitEntryText } from "./entry-labels";
import { entryChatTarget } from "./entry-source";
import { HashtagText } from "./hashtag-text";

type TrackedAsk = NonNullable<CompanionEntry["ask"]>;

export interface EntryCardProps {
  entry: CompanionEntry;
  serverId?: string;
  disabled?: boolean;
  onReturnToChat: () => void;
  onReplyInChat: () => void;
  /** Opens Chat scrolled to where the entry came from; offered when the entry has a place. */
  onShowInChat?: (target: ChatJumpTarget) => void;
  onUpdateStatus: (id: string, status: "open" | "reviewed" | "done") => void;
  onRemovePin: (id: string) => void;
  /** Tapping a #hashtag in the text adds it to the Stream tag filter. */
  onTagPress?: (tag: string) => void;
}

/** Eyebrow (kind · state · time), then the entry text as the headline. Details sit behind Read. */
export function EntryCard({
  entry,
  serverId,
  onReturnToChat,
  onReplyInChat,
  onShowInChat,
  onUpdateStatus,
  onRemovePin,
  onTagPress,
  disabled = false,
}: EntryCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const handleRemovePin = useCallback(() => onRemovePin(entry.id), [onRemovePin, entry.id]);
  const pending = isCompanionEntryPending(entry);
  const expandedAccessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const eyebrow = describeEntry(entry, t);
  const time = formatMessageTimestamp(new Date(entry.timestamp));
  const quote = entry.kind === "pin" && Boolean(entry.sourceId);

  return (
    <View
      style={[styles.card, pending && styles.pendingCard]}
      testID={`companion-entry-${entry.id}`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow} testID="companion-entry-eyebrow">
          {eyebrow.kind}
          {eyebrow.status ? (
            <Text style={pending ? styles.pendingText : undefined}>
              {" · "}
              {eyebrow.status}
            </Text>
          ) : null}
          {` · ${time}`}
        </Text>
        {entry.kind === "pin" ? (
          <Button variant="ghost" size="sm" onPress={handleRemovePin} disabled={disabled}>
            <Text style={styles.description}>{t("agentPanel.stream.unpin")}</Text>
          </Button>
        ) : null}
      </View>

      <EntryBody entry={entry} expanded={expanded} quote={quote} onTagPress={onTagPress} />
      {entry.inputRequest ? <InputRequestDetails entry={entry} /> : null}
      {expanded && entry.ask ? <AskDetails ask={entry.ask} serverId={serverId} /> : null}

      {entry.truncated ? (
        <Text style={styles.description}>{t("agentPanel.stream.excerpt")}</Text>
      ) : null}

      <View style={styles.actions}>
        {entry.text || entry.ask ? (
          <Button
            variant="ghost"
            style={styles.touchTarget}
            onPress={toggleExpanded}
            accessibilityState={expandedAccessibilityState}
          >
            {t(expanded ? "agentPanel.stream.showLess" : "agentPanel.stream.read")}
          </Button>
        ) : null}
        <ChatActions
          entry={entry}
          pending={pending}
          quote={quote}
          onReturnToChat={onReturnToChat}
          onReplyInChat={onReplyInChat}
          onShowInChat={onShowInChat}
        />
        {entry.kind === "question" || entry.kind === "feature_request" ? (
          <StatusActions
            entryId={entry.id}
            tracked={Boolean(entry.ask)}
            needsInput={needsUserInput(entry)}
            disabled={disabled}
            onUpdateStatus={onUpdateStatus}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * Show in chat when Chat can place the entry; it already returns to Chat, so Back to chat and
 * Open source give way to it. A pending entry still offers Reply in chat.
 */
function ChatActions({
  entry,
  pending,
  quote,
  onReturnToChat,
  onReplyInChat,
  onShowInChat,
}: {
  entry: CompanionEntry;
  pending: boolean;
  quote: boolean;
  onReturnToChat: () => void;
  onReplyInChat: () => void;
  onShowInChat?: (target: ChatJumpTarget) => void;
}) {
  const { t } = useTranslation();
  const target = useMemo(
    () => (onShowInChat ? entryChatTarget(entry) : null),
    [entry, onShowInChat],
  );
  const showInChat = useCallback(() => {
    if (target) onShowInChat?.(target);
  }, [target, onShowInChat]);
  let chatAction = quote ? "agentPanel.stream.openSource" : "agentPanel.stream.backToChat";
  if (pending) chatAction = "agentPanel.stream.replyInChat";
  return (
    <>
      {target ? (
        <Button
          variant="outline"
          style={styles.touchTarget}
          onPress={showInChat}
          accessibilityHint={t("agentPanel.stream.showInChatHint")}
          testID="companion-entry-show-in-chat"
        >
          {t("agentPanel.stream.showInChat")}
        </Button>
      ) : null}
      {pending || !target ? (
        <Button
          variant={pending ? "secondary" : "outline"}
          style={styles.touchTarget}
          onPress={pending ? onReplyInChat : onReturnToChat}
        >
          {t(chatAction)}
        </Button>
      ) : null}
    </>
  );
}

function InputRequestDetails({ entry }: { entry: CompanionEntry }) {
  const { t } = useTranslation();
  const request = entry.inputRequest;
  const task = request?.task;
  const openTask = useCallback(() => {
    if (task) navigateToAgent({ serverId: task.serverId, agentId: task.agentId });
  }, [task]);
  if (!request) return null;
  return (
    <View style={styles.text}>
      <Text style={styles.description}>
        {t(`globalStream.inputKinds.${request.kind}`)} ·{" "}
        {t(`globalStream.recipients.${request.recipient}`)}
        {request.recipientId ? ` · ${request.recipientId}` : ""}
      </Text>
      {request.subtaskId ? (
        <Text selectable style={styles.description}>
          {t("globalStream.subtask", { id: request.subtaskId })}
        </Text>
      ) : null}
      {request.sourceMessageId ? (
        <Text selectable style={styles.description}>
          {t("agentPanel.stream.card.sourceMessage", { id: request.sourceMessageId })}
        </Text>
      ) : null}
      {task ? (
        <Button variant="ghost" onPress={openTask}>
          {t("globalStream.openTaskSource")}
        </Button>
      ) : null}
    </View>
  );
}

function LinkedSession({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const open = useCallback(() => navigateToAgent({ serverId, agentId }), [serverId, agentId]);
  return (
    <Button variant="ghost" onPress={open}>
      {t("globalStream.openLinkedSession", { id: agentId })}
    </Button>
  );
}

function StatusActions({
  entryId,
  tracked,
  needsInput,
  disabled,
  onUpdateStatus,
}: {
  entryId: string;
  tracked: boolean;
  needsInput: boolean;
  disabled: boolean;
  onUpdateStatus: EntryCardProps["onUpdateStatus"];
}) {
  const { t } = useTranslation();
  const reviewLabel = tracked
    ? "agentPanel.stream.card.markInProgress"
    : "agentPanel.stream.card.markReviewed";
  const setOpen = useCallback(() => onUpdateStatus(entryId, "open"), [onUpdateStatus, entryId]);
  const setReviewed = useCallback(
    () => onUpdateStatus(entryId, "reviewed"),
    [onUpdateStatus, entryId],
  );
  const setDone = useCallback(() => onUpdateStatus(entryId, "done"), [onUpdateStatus, entryId]);
  return (
    <View style={styles.statusActionsRow}>
      <Button variant="outline" onPress={setOpen} disabled={disabled}>
        {t("agentPanel.stream.card.markOpen")}
      </Button>
      <Button variant="outline" onPress={setReviewed} disabled={disabled}>
        {t(needsInput ? "globalStream.markSeenStillNeeded" : reviewLabel)}
      </Button>
      {/* A tracked ask is completed by its owner with evidence, never by a tap. */}
      <Button variant="outline" onPress={setDone} disabled={disabled || tracked}>
        {t("agentPanel.stream.card.markDone")}
      </Button>
    </View>
  );
}

function EntryBody({
  entry,
  expanded,
  quote,
  onTagPress,
}: {
  entry: CompanionEntry;
  expanded: boolean;
  quote: boolean;
  onTagPress?: (tag: string) => void;
}) {
  const { t } = useTranslation();
  if (!entry.text) return null;
  const answerText = entry.reply?.text ?? (entry.kind === "q_and_a" ? entry.answer : undefined);
  const answer = answerText ? (
    <View style={styles.qaAnswerContainer}>
      <Text style={styles.qaAnswerLabel}>
        {t(
          entry.reply?.provenance === "candidate"
            ? "agentPanel.stream.possibleAnswerLabel"
            : "agentPanel.stream.answerLabel",
        )}
      </Text>
      {expanded ? (
        <MarkdownRenderer text={answerText} compact enableHtmlish={false} />
      ) : (
        <Text selectable style={styles.body} numberOfLines={6}>
          {answerText}
        </Text>
      )}
    </View>
  ) : null;
  if (expanded) {
    return (
      <View>
        <MarkdownRenderer text={entry.text} compact enableHtmlish={false} />
        {answer}
      </View>
    );
  }
  if (quote) {
    // A saved excerpt reads as a quotation: the passage itself is the card.
    return (
      <View style={styles.quote} testID="companion-entry-quote">
        <HashtagText
          text={entry.text.trim()}
          style={styles.quoteText}
          numberOfLines={8}
          onTagPress={onTagPress}
        />
      </View>
    );
  }
  const { headline, rest } = splitEntryText(entry.text);
  return (
    <View style={styles.text}>
      <HashtagText
        text={headline}
        style={styles.headline}
        numberOfLines={3}
        onTagPress={onTagPress}
      />
      {rest ? (
        <HashtagText text={rest} style={styles.body} numberOfLines={5} onTagPress={onTagPress} />
      ) : null}
      {answer}
    </View>
  );
}

function AskDetails({ ask, serverId }: { ask: TrackedAsk; serverId?: string }) {
  const { t } = useTranslation();
  const delegatedAgentId = ask.delegatedAgentId;
  const openDelegated = useCallback(() => {
    if (serverId && delegatedAgentId) navigateToAgent({ serverId, agentId: delegatedAgentId });
  }, [serverId, delegatedAgentId]);
  const subtasks = ask.subtasks ?? [];
  return (
    <View style={styles.details} testID="companion-entry-ask-details">
      {subtasks.length ? (
        <Text style={styles.description}>
          {t("agentPanel.stream.card.subtasksDone", {
            done: subtasks.filter((task) => task.done).length,
            total: subtasks.length,
          })}
        </Text>
      ) : null}
      {subtasks.map((task) => (
        <Text key={task.id} style={styles.body}>
          {task.done ? "✓" : "○"} {task.text}
        </Text>
      ))}
      <Text selectable style={styles.description}>
        {t(
          ask.state === "done"
            ? "agentPanel.stream.card.completionEvidence"
            : "agentPanel.stream.card.evidence",
          { text: ask.evidence || t("agentPanel.stream.card.noEvidence") },
        )}
      </Text>
      {ask.state !== "done" ? (
        <Text selectable style={styles.body}>
          {t("agentPanel.stream.card.remaining", {
            text: ask.remaining || t("agentPanel.stream.card.remainingUnspecified"),
          })}
        </Text>
      ) : null}
      {ask.taskId ? (
        <Text selectable style={styles.description}>
          {t("globalStream.taskIdentity", { id: ask.taskId })}
        </Text>
      ) : null}
      {ask.sessions?.map((session) => (
        <LinkedSession
          key={JSON.stringify([session.serverId, session.agentId])}
          serverId={session.serverId}
          agentId={session.agentId}
        />
      ))}
      {ask.canonicalTask ? (
        <LinkedSession serverId={ask.canonicalTask.serverId} agentId={ask.canonicalTask.agentId} />
      ) : null}
      {ask.sourceMessageId ? (
        <Text selectable style={styles.description}>
          {t("agentPanel.stream.card.sourceMessage", { id: ask.sourceMessageId })}
        </Text>
      ) : null}
      {delegatedAgentId && serverId ? (
        <Button variant="outline" onPress={openDelegated}>
          {t("agentPanel.stream.card.openDelegated")}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[2],
  },
  pendingCard: { borderLeftWidth: 3, borderLeftColor: theme.colors.accent },
  pendingText: { color: theme.colors.accent },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 20,
  },
  eyebrow: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  text: { gap: theme.spacing[1] },
  headline: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 22,
  },
  body: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, lineHeight: 20 },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.borderAccent,
    paddingLeft: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  quoteText: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, lineHeight: 26 },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  details: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  touchTarget: { minHeight: 44 },
  statusActionsRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
    width: "100%",
  },
  qaAnswerContainer: {
    marginTop: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  qaAnswerLabel: {
    fontWeight: theme.fontWeight.semibold,
    marginBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
