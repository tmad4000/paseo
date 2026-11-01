import {
  isCompanionEntryPending,
  needsUserInput,
  type CompanionEntry,
} from "@getpaseo/protocol/companion-stream";
import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { useIsCompactFormFactor } from "@/constants/layout";
import { formatMessageTimestamp } from "@/utils/time";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { ChatJumpTarget } from "@/agent-stream/use-timeline-anchor-jump";
import { describeEntry, splitEntryText } from "./entry-labels";
import { entryChatTarget } from "./entry-source";
import { HashtagText } from "./hashtag-text";

type TrackedAsk = NonNullable<CompanionEntry["ask"]>;
type ActionSize = "xs" | "sm";

const ReplyInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

export interface EntryCardProps {
  entry: CompanionEntry;
  serverId?: string;
  disabled?: boolean;
  onReturnToChat: () => void;
  /** Quotes the entry into Chat's composer and focuses it, so the reply says what it answers. */
  onReplyInChat: (entry: CompanionEntry) => void;
  /** Opens Chat scrolled to where the entry came from; offered when the entry has a place. */
  onShowInChat?: (target: ChatJumpTarget) => void;
  onUpdateStatus: (id: string, status: "open" | "reviewed" | "done") => void;
  onRemovePin: (id: string) => void;
  /** Tapping a #hashtag in the text adds it to the Stream tag filter. */
  onTagPress?: (tag: string) => void;
  /**
   * Answers from the card itself, so triage never leaves the list. Resolves with whether the
   * agent was busy and the reply waits in its queue. Without it, Reply goes to Chat's composer.
   */
  onSendReply?: (entry: CompanionEntry, text: string) => Promise<{ queued: boolean }>;
  /** Sets a request aside for later (true) or brings it back (false). Status is unchanged. */
  onDefer?: (id: string, deferred: boolean) => void;
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
  onSendReply,
  onDefer,
  disabled = false,
}: EntryCardProps) {
  const { t } = useTranslation();
  const actionSize: ActionSize = useIsCompactFormFactor() ? "sm" : "xs";
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const toggleReplying = useCallback(() => setReplying((value) => !value), []);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const pending = isCompanionEntryPending(entry);
  const quote = entry.kind === "pin" && Boolean(entry.sourceId);
  // Only an agent's question takes a typed answer; a permission is allowed or denied in Chat.
  const inlineReply = pending && entry.kind === "question" && onSendReply ? onSendReply : undefined;

  return (
    <View
      style={[styles.card, pending && styles.pendingCard]}
      testID={`companion-entry-${entry.id}`}
    >
      <EntryHeader entry={entry} pending={pending} disabled={disabled} onRemovePin={onRemovePin} />
      <EntryBody entry={entry} expanded={expanded} quote={quote} onTagPress={onTagPress} />
      {entry.inputRequest ? <InputRequestDetails entry={entry} /> : null}
      {expanded && entry.ask ? <AskDetails ask={entry.ask} serverId={serverId} /> : null}

      {entry.truncated ? (
        <Text style={styles.description}>{t("agentPanel.stream.excerpt")}</Text>
      ) : null}

      {/* One wrapping row of small actions: the card's text, not its buttons, takes the space. */}
      <View style={styles.actions}>
        <ChatActions
          entry={entry}
          pending={pending}
          quote={quote}
          size={actionSize}
          replying={replying}
          onToggleInlineReply={inlineReply ? toggleReplying : undefined}
          onReturnToChat={onReturnToChat}
          onReplyInChat={onReplyInChat}
          onShowInChat={onShowInChat}
        />
        <DeferButton entry={entry} size={actionSize} disabled={disabled} onDefer={onDefer} />
        {entry.kind === "question" || entry.kind === "feature_request" ? (
          <StatusActions
            entryId={entry.id}
            status={entry.status}
            tracked={Boolean(entry.ask)}
            needsInput={needsUserInput(entry)}
            disabled={disabled}
            size={actionSize}
            onUpdateStatus={onUpdateStatus}
          />
        ) : null}
        {entry.text || entry.ask ? (
          <ReadToggle expanded={expanded} size={actionSize} onToggle={toggleExpanded} />
        ) : null}
      </View>
      {inlineReply && replying ? (
        <InlineReply
          entry={entry}
          disabled={disabled}
          size={actionSize}
          onSend={inlineReply}
          onClose={toggleReplying}
        />
      ) : null}
    </View>
  );
}

/** Kind · state · time as a muted eyebrow, with Unpin on saved items. */
function EntryHeader({
  entry,
  pending,
  disabled,
  onRemovePin,
}: {
  entry: CompanionEntry;
  pending: boolean;
  disabled: boolean;
  onRemovePin: (id: string) => void;
}) {
  const { t } = useTranslation();
  const handleRemovePin = useCallback(() => onRemovePin(entry.id), [onRemovePin, entry.id]);
  const eyebrow = describeEntry(entry, t);
  const time = formatMessageTimestamp(new Date(entry.timestamp));
  return (
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
        <Button variant="ghost" size="xs" onPress={handleRemovePin} disabled={disabled}>
          <Text style={styles.description}>{t("agentPanel.stream.unpin")}</Text>
        </Button>
      ) : null}
    </View>
  );
}

/** Later sets a waiting request aside without touching its status; Bring back undoes it. */
function DeferButton({
  entry,
  size,
  disabled,
  onDefer,
}: {
  entry: CompanionEntry;
  size: ActionSize;
  disabled: boolean;
  onDefer?: (id: string, deferred: boolean) => void;
}) {
  const { t } = useTranslation();
  const deferred = Boolean(entry.deferredAt);
  const toggle = useCallback(() => onDefer?.(entry.id, !deferred), [onDefer, entry.id, deferred]);
  if (!onDefer || (!deferred && !needsUserInput(entry))) return null;
  return (
    <Button
      variant="ghost"
      size={size}
      onPress={toggle}
      disabled={disabled}
      accessibilityHint={t(
        deferred ? "agentPanel.stream.bringBackHint" : "agentPanel.stream.laterHint",
      )}
      testID="companion-entry-defer"
    >
      {t(deferred ? "agentPanel.stream.bringBack" : "agentPanel.stream.later")}
    </Button>
  );
}

function ReadToggle({
  expanded,
  size,
  onToggle,
}: {
  expanded: boolean;
  size: ActionSize;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  return (
    <Button variant="ghost" size={size} onPress={onToggle} accessibilityState={accessibilityState}>
      {t(expanded ? "agentPanel.stream.showLess" : "agentPanel.stream.read")}
    </Button>
  );
}

/**
 * Answer an agent's question in place. The reply quotes the question, as Reply in chat does, and
 * goes through the agent's queue: an idle agent starts on it, a busy one gets it after its turn.
 */
function InlineReply({
  entry,
  disabled,
  size,
  onSend,
  onClose,
}: {
  entry: CompanionEntry;
  disabled: boolean;
  size: ActionSize;
  onSend: (entry: CompanionEntry, text: string) => Promise<{ queued: boolean }>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<EditingTextInputHandle>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"sent" | "queued" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = useCallback(() => {
    const reply = text.trim();
    if (!reply || sending) return;
    setSending(true);
    setError(null);
    onSend(entry, reply)
      .then(({ queued }) => {
        setResult(queued ? "queued" : "sent");
        setText("");
        input.current?.replaceText("");
        return;
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : t("agentPanel.stream.replyFailed"));
      })
      .finally(() => setSending(false));
  }, [text, sending, onSend, entry, t]);
  return (
    <View style={styles.reply} testID="companion-entry-inline-reply">
      <View style={styles.replyRow}>
        <ReplyInput
          ref={input}
          style={styles.replyInput}
          placeholder={t("agentPanel.stream.replyPlaceholder")}
          maxLength={4000}
          editable={!sending}
          initialValue=""
          autoFocus
          onChangeText={setText}
          onSubmitEditing={send}
          testID="companion-entry-reply-input"
        />
        <Button
          size={size}
          onPress={send}
          disabled={disabled || sending || !text.trim()}
          testID="companion-entry-reply-send"
        >
          {t("agentPanel.stream.send")}
        </Button>
        <Button variant="ghost" size={size} onPress={onClose}>
          {t("agentPanel.stream.cancel")}
        </Button>
      </View>
      {result ? (
        <Text style={styles.description} accessibilityRole="alert">
          {t(result === "queued" ? "agentPanel.stream.replyQueued" : "agentPanel.stream.replySent")}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
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
  size,
  replying,
  onToggleInlineReply,
  onReturnToChat,
  onReplyInChat,
  onShowInChat,
}: {
  entry: CompanionEntry;
  pending: boolean;
  quote: boolean;
  size: ActionSize;
  replying: boolean;
  /** When set, Reply opens a reply box on the card instead of going to Chat. */
  onToggleInlineReply?: () => void;
  onReturnToChat: () => void;
  onReplyInChat: (entry: CompanionEntry) => void;
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
  const replyInChat = useCallback(() => onReplyInChat(entry), [entry, onReplyInChat]);
  let chatAction = quote ? "agentPanel.stream.openSource" : "agentPanel.stream.backToChat";
  if (pending)
    chatAction = onToggleInlineReply ? "agentPanel.stream.reply" : "agentPanel.stream.replyInChat";
  const replyState = useMemo(() => ({ expanded: replying }), [replying]);
  let chatPress = onReturnToChat;
  if (pending) chatPress = onToggleInlineReply ?? replyInChat;
  return (
    <>
      {pending || !target ? (
        <Button
          variant={pending ? "secondary" : "ghost"}
          size={size}
          onPress={chatPress}
          accessibilityState={onToggleInlineReply ? replyState : undefined}
          testID={pending ? "companion-entry-reply" : undefined}
        >
          {t(chatAction)}
        </Button>
      ) : null}
      {target ? (
        <Button
          variant="ghost"
          size={size}
          onPress={showInChat}
          accessibilityHint={t("agentPanel.stream.showInChatHint")}
          testID="companion-entry-show-in-chat"
        >
          {t("agentPanel.stream.showInChat")}
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

/** Only the moves that change something: no Mark open on an open item, no Done on a done one. */
function StatusActions({
  entryId,
  status,
  tracked,
  needsInput,
  disabled,
  size,
  onUpdateStatus,
}: {
  entryId: string;
  status: string;
  tracked: boolean;
  needsInput: boolean;
  disabled: boolean;
  size: ActionSize;
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
    <>
      {status !== "open" ? (
        <Button variant="ghost" size={size} onPress={setOpen} disabled={disabled}>
          {t("agentPanel.stream.card.markOpen")}
        </Button>
      ) : null}
      {status === "open" ? (
        <Button variant="ghost" size={size} onPress={setReviewed} disabled={disabled}>
          {t(needsInput ? "globalStream.markSeenStillNeeded" : reviewLabel)}
        </Button>
      ) : null}
      {/* A tracked ask is completed by its owner with evidence, never by a tap. */}
      {status !== "done" ? (
        <Button variant="ghost" size={size} onPress={setDone} disabled={disabled || tracked}>
          {t("agentPanel.stream.card.markDone")}
        </Button>
      ) : null}
    </>
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
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
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
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: -theme.spacing[2],
  },
  reply: { gap: theme.spacing[1] },
  replyRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  replyInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  error: { color: theme.colors.statusWarning, fontSize: theme.fontSize.sm },
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
