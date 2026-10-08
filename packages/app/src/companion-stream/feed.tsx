import { buildAgentDeepLink, buildAgentDeepLinkRoute } from "@getpaseo/protocol/agent-deep-link";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { isWeb, getIsElectron } from "@/constants/platform";
import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import { isCompanionEntryPending, type CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArtifactCard, ArtifactFeed } from "@/artifacts/feed";
import { useSessionStore } from "@/stores/session-store";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useHostRuntimeConnectionStatus, useHostRuntimeClient } from "@/runtime/host-runtime";
import { formatMessageTimestamp } from "@/utils/time";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { buildCompanionFeed, type CompanionFeedItem } from "./model";
import { useGlobalStream } from "./use-global-stream";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { ArtifactPinOperations } from "./artifact-pin-operations";

interface CompanionFeedProps {
  serverId: string;
  agentId: string;
  cwd: string;
  entries: readonly CompanionEntry[];
  artifacts: readonly AgentArtifact[];
  isSupported: boolean;
  artifactsSupported: boolean;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
  onReturnToChat: () => void;
  onReplyInChat: () => void;
  onOpenSource?: (seq: number, epoch: string) => void;
}

const keyExtractor = (item: CompanionFeedItem) => item.id;
const NoteInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

type ViewTab = "checklist" | "stream" | "pinned";

export function CompanionFeed({
  serverId,
  agentId,
  cwd,
  artifacts,
  isSupported,
  artifactsSupported,
  onOpenWorkspaceFile,
  onReturnToChat,
  onReplyInChat,
  onOpenSource,
}: CompanionFeedProps) {
  const { t } = useTranslation();
  const connection = useHostRuntimeConnectionStatus(serverId);
  const client = useHostRuntimeClient(serverId);
  const supportsWrites = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.globalStream === true,
  );
  // COMPAT(streamMessageInventory): added in fork beta.11; remove after 2027-04-07 once host floor includes durable Stream.
  const supportsDurableStream = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.streamMessageInventory === true,
  );
  const [saving, setSaving] = useState(false);
  const draftEntryId = useRef<string | null>(null);
  const artifactPins = useRef(new ArtifactPinOperations());
  const [saveError, setSaveError] = useState<string | null>(null);

  const [viewTab, setViewTab] = useState<ViewTab>("stream");
  const [status, setStatus] = useState<"all" | "open" | "done">("all");
  const [sourceRole, setSourceRole] = useState<"all" | "user" | "agent">("all");
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const resetFilters = useCallback(() => {
    setStatus("all");
    setSourceRole("all");
  }, []);
  const copyStreamLink = useCallback(async () => {
    try {
      const target = { serverId, agentId, view: "stream" as const };
      const link =
        isWeb && !getIsElectron()
          ? new URL(buildAgentDeepLinkRoute(target), window.location.origin).href
          : buildAgentDeepLink(target);
      await copyToClipboard(link);
      setLinkNotice("Stream link copied");
    } catch {
      setLinkNotice("Could not copy the Stream link. Try again.");
    }
  }, [serverId, agentId]);
  const [pinText, setPinText] = useState("");
  const noteInput = useRef<EditingTextInputHandle>(null);

  const query = useGlobalStream({
    serverId,
    agentId,
    asksOnly: viewTab === "checklist",
    filter: viewTab === "pinned" ? "pinned" : "all",
    state: viewTab === "pinned" ? "all" : status,
    sourceRole: viewTab === "pinned" ? "all" : sourceRole,
    includeMessageInventory: true,
    includeArchived: true,
    enabled: isSupported && supportsDurableStream,
  });
  const { refetch, fetchNextPage } = query;
  const items = useMemo(
    () =>
      buildCompanionFeed(
        query.rows.flatMap((row) => (row.item.kind === "entry" ? [row.item.entry] : [])),
        query.rows.flatMap((row) => (row.item.kind === "artifact" ? [row.item.artifact] : [])),
      ),
    [query.rows],
  );
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const loadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  const visible = items;

  const openArtifact = useCallback(
    (artifact: AgentArtifact) => {
      onOpenWorkspaceFile?.({ location: { path: artifact.path }, disposition: "side" });
      onReturnToChat();
    },
    [onOpenWorkspaceFile, onReturnToChat],
  );

  const save = useCallback(
    async (input: Parameters<NonNullable<typeof client>["updateStreamEntry"]>[0]) => {
      setSaving(true);
      setSaveError(null);
      try {
        if (!client || !supportsWrites || connection !== "online")
          throw new Error(t("globalStream.writeUnavailable"));
        await client.updateStreamEntry(input);
        await refetch();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : t("globalStream.saveFailed"));
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [client, connection, supportsWrites, t, refetch],
  );
  const handleUpdateStatus = useCallback(
    (entryId: string, nextStatus: "open" | "reviewed" | "done") => {
      const entry = items.find((item) => item.id === entryId);
      const expectedRevision = entry?.kind === "entry" ? entry.entry.ask?.revision : undefined;
      void save({
        agentId,
        entryId,
        action: "update_status",
        status: nextStatus,
        expectedRevision,
      }).catch(() => undefined);
    },
    [save, agentId, items],
  );
  const handleRemovePin = useCallback(
    (entryId: string) => {
      void save({ agentId, entryId, action: "remove_pin" }).catch(() => undefined);
    },
    [save, agentId],
  );
  const handlePinArtifact = useCallback(
    (artifact: { path: string }) => {
      void artifactPins.current.save(serverId, agentId, artifact.path, save).catch(() => undefined);
    },
    [save, serverId, agentId],
  );

  const renderItem = useCallback(
    ({ item }: { item: CompanionFeedItem }) =>
      item.kind === "artifact" ? (
        <ArtifactCard
          artifact={item.artifact}
          serverId={serverId}
          cwd={cwd}
          onOpen={openArtifact}
          // eslint-disable-next-line react-perf/jsx-no-new-function-as-prop
          onPin={() => handlePinArtifact(item.artifact)}
        />
      ) : (
        <EntryCard
          entry={item.entry}
          serverId={serverId}
          onReturnToChat={onReturnToChat}
          onReplyInChat={onReplyInChat}
          onOpenSource={onOpenSource}
          onUpdateStatus={handleUpdateStatus}
          onRemovePin={handleRemovePin}
          disabled={saving || !supportsWrites || connection !== "online"}
        />
      ),
    [
      serverId,
      cwd,
      openArtifact,
      handlePinArtifact,
      onReturnToChat,
      onReplyInChat,
      onOpenSource,
      handleUpdateStatus,
      handleRemovePin,
      saving,
      supportsWrites,
      connection,
    ],
  );

  const handleSubmitPin = useCallback(() => {
    if (!pinText.trim() || saving) return;
    void save({
      agentId,
      action: ({ pinned: "add_pin", checklist: "set_ask", stream: "add_question" } as const)[
        viewTab
      ],
      ...(viewTab === "checklist"
        ? { expectedRevision: 0, ask: { state: "open" as const, remaining: "", evidence: "" } }
        : {}),
      entryId: (draftEntryId.current ??= globalThis.crypto.randomUUID()),
      text: pinText.trim(),
    })
      .then(() => {
        draftEntryId.current = null;
        setPinText("");
        noteInput.current?.replaceText("");
        return;
      })
      .catch(() => undefined);
  }, [save, agentId, pinText, viewTab, saving]);

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <Text style={styles.title}>{t("agentPanel.stream.title")}</Text>
        <Text style={styles.description}>
          Activity, source messages and tracked asks in this conversation.
        </Text>

        {connection !== "online" ? (
          <View style={styles.notice} testID="companion-stream-connection">
            {connection === "connecting" ? <ActivityIndicator size="small" /> : null}
            <Text style={styles.description}>{t("agentPanel.stream.offline")}</Text>
          </View>
        ) : null}

        <SegmentedControl
          value={viewTab}
          onValueChange={setViewTab}
          options={[
            { value: "checklist", label: "Checklist" },
            { value: "stream", label: "Activity" },
            { value: "pinned", label: t("agentPanel.stream.pinnedTab") },
          ]}
        />

        <Button variant="outline" onPress={copyStreamLink}>
          Copy Stream link
        </Button>
        {linkNotice ? (
          <Text accessibilityRole="alert" style={styles.description}>
            {linkNotice}
          </Text>
        ) : null}
        <Button
          variant="ghost"
          onPress={refresh}
          disabled={query.isFetching || connection !== "online"}
        >
          Refresh
        </Button>
        {query.notices.map((notice) => (
          <Text key={notice} accessibilityRole="alert" style={styles.description}>
            {notice}
          </Text>
        ))}
        {viewTab === "checklist" ? (
          <Text style={styles.description}>
            Confirmed asks and unreviewed user messages. A message can contain several asks. Ask
            your agent to review each message, split its requests and record evidence. A reply, tool
            call or turn ending never completes an ask.
          </Text>
        ) : null}
        {saveError ? (
          <Text accessibilityRole="alert" style={styles.description}>
            {saveError}
          </Text>
        ) : null}
        {saving ? <Text style={styles.description}>{t("globalStream.saving")}</Text> : null}
        {!supportsWrites ? (
          <Text style={styles.description}>{t("globalStream.writeUnavailable")}</Text>
        ) : null}
        {viewTab !== "pinned" ? (
          <StreamFilters
            status={status}
            setStatus={setStatus}
            sourceRole={sourceRole}
            setSourceRole={setSourceRole}
            viewTab={viewTab}
            counts={query.counts}
            resetFilters={resetFilters}
          />
        ) : null}
        <Text style={styles.description} testID="stream-coverage">
          {query.coverage === "loaded_history"
            ? "Loaded Chat messages are indexed. Source review is not automatic semantic extraction; check unreviewed messages for every ask."
            : "Older history is not fully indexed. Open Chat to load retained history, then refresh Stream. Unavailable or previously pruned records cannot be recovered here."}
        </Text>

        {supportsWrites && (
          <View style={styles.pinInputContainer}>
            <NoteInput
              ref={noteInput}
              style={styles.pinInput}
              placeholder={
                viewTab === "checklist"
                  ? "A request to track…"
                  : t(
                      viewTab === "pinned"
                        ? "agentPanel.stream.notePlaceholder"
                        : "globalStream.questionPlaceholder",
                    )
              }
              maxLength={4000}
              editable={!saving}
              initialValue=""
              onChangeText={setPinText}
              onSubmitEditing={handleSubmitPin}
            />
            <Button
              onPress={handleSubmitPin}
              disabled={saving || connection !== "online" || !pinText.trim()}
            >
              {viewTab === "checklist"
                ? "Add ask"
                : t(
                    viewTab === "pinned" ? "agentPanel.stream.addNote" : "globalStream.addQuestion",
                  )}
            </Button>
          </View>
        )}
      </View>
    ),
    [
      connection,
      refresh,
      query.isFetching,
      query.notices,
      viewTab,
      status,
      sourceRole,
      query.counts,
      query.coverage,
      resetFilters,
      copyStreamLink,
      linkNotice,
      t,
      handleSubmitPin,
      supportsWrites,
      saveError,
      saving,
      pinText,
    ],
  );

  const empty = useMemo(
    () => (
      <View style={styles.empty} testID="companion-stream-empty">
        <Text style={styles.title}>
          {emptyStreamLabel(
            query.isLoading,
            connection,
            query.notices.length,
            query.counts?.total,
            viewTab,
          )}
        </Text>
        {query.counts?.total ? (
          <Button variant="outline" onPress={resetFilters}>
            Show all items
          </Button>
        ) : null}
        <Button variant="outline" style={styles.touchTarget} onPress={onReturnToChat}>
          {t("agentPanel.stream.backToChat")}
        </Button>
      </View>
    ),
    [
      viewTab,
      onReturnToChat,
      t,
      query.isLoading,
      query.notices.length,
      query.counts,
      connection,
      resetFilters,
    ],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {query.hasNextPage ? (
          <Button onPress={loadMore} disabled={query.isFetching || connection !== "online"}>
            Load more
          </Button>
        ) : null}
        {query.isLoading ? <ActivityIndicator /> : null}
        <Text style={styles.description}>
          All captured Stream history is kept. Pages load 50 items at a time. Earlier pruned entries
          are not restored.
        </Text>
      </View>
    ),
    [query.hasNextPage, query.isFetching, query.isLoading, loadMore, connection],
  );

  if (!isSupported || !supportsDurableStream) {
    return (
      <View style={styles.root}>
        <View style={styles.notice} testID="companion-stream-unsupported">
          <Text style={styles.title}>{t("agentPanel.stream.updateHost")}</Text>
          <Text style={styles.description}>{t("agentPanel.stream.updateHostDescription")}</Text>
        </View>
        <ArtifactFeed
          serverId={serverId}
          cwd={cwd}
          artifacts={artifacts}
          isSupported={artifactsSupported}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
          onReturnToChat={onReturnToChat}
        />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.feed}
      testID="companion-stream"
      data={visible}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ItemSeparatorComponent={CardSeparator}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
    />
  );
}

function CardSeparator() {
  return <View style={styles.separator} />;
}

// eslint-disable-next-line complexity
export function EntryCard({
  entry,
  serverId,
  onReturnToChat,
  onReplyInChat,
  onOpenSource,
  onUpdateStatus,
  onRemovePin,
  disabled = false,
}: {
  entry: CompanionEntry;
  serverId?: string;
  disabled?: boolean;
  onReturnToChat: () => void;
  onReplyInChat: () => void;
  onOpenSource?: (seq: number, epoch: string) => void;
  onUpdateStatus: (id: string, status: "open" | "reviewed" | "done") => void;
  onRemovePin: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const handleSetOpen = useCallback(
    () => onUpdateStatus(entry.id, "open"),
    [onUpdateStatus, entry.id],
  );
  const handleSetReviewed = useCallback(
    () => onUpdateStatus(entry.id, "reviewed"),
    [onUpdateStatus, entry.id],
  );
  const handleSetDone = useCallback(
    () => onUpdateStatus(entry.id, "done"),
    [onUpdateStatus, entry.id],
  );
  const handleRemovePinLocal = useCallback(() => onRemovePin(entry.id), [onRemovePin, entry.id]);
  const openDelegated = useCallback(() => {
    if (serverId && entry.ask?.delegatedAgentId)
      navigateToAgent({ serverId, agentId: entry.ask.delegatedAgentId });
  }, [serverId, entry.ask?.delegatedAgentId]);
  const openSource = useCallback(() => {
    if (entry.source?.seq !== undefined && entry.source.epoch)
      onOpenSource?.(entry.source.seq, entry.source.epoch);
  }, [entry.source, onOpenSource]);
  const pending = isCompanionEntryPending(entry);
  const expandedAccessibilityState = useMemo(() => ({ expanded }), [expanded]);

  let title: string;
  let status: string = "";
  if (entry.kind === "question") {
    title = t("agentPanel.stream.question");
    if (entry.id.startsWith("turn:")) title = "Question · inferred from text";
    if (entry.ask) title = "Tracked ask · explicit";
    if (entry.messageReview) title = "Your message · request inventory";
    status = entry.ask
      ? { open: "Open", in_progress: "In progress", blocked: "Blocked", done: "Done" }[
          entry.ask.state
        ]
      : entry.status;
  } else if (entry.kind === "feature_request") {
    title = "Feature Request";
    status = entry.status;
  } else if (entry.kind === "permission") {
    const titles = {
      question: "question",
      plan: "decision",
      tool: "permission",
      mode: "permission",
      other: "permission",
    } as const;
    title = t(`agentPanel.stream.${titles[entry.requestKind]}`);
    status = t(
      entry.status === "pending"
        ? "agentPanel.stream.pendingStatus"
        : `agentPanel.stream.${entry.status}`,
    );
  } else if (entry.kind === "pin") {
    title = "Pinned Note";
  } else if (entry.kind === "q_and_a") {
    title = "Q&A";
  } else {
    title = t(`agentPanel.stream.${entry.status}`);
  }

  if (entry.source?.role === "agent" && !entry.ask) title = "Agent message";
  if (entry.messageReview)
    status =
      entry.messageReview.state === "unreviewed"
        ? "Needs ask review"
        : "Source reviewed · not task completion";

  let body = null;
  if (entry.text) {
    body = expanded ? (
      <View>
        <MarkdownRenderer text={entry.text} compact enableHtmlish={false} />
        {entry.kind === "q_and_a" && entry.answer && (
          <View style={styles.qaAnswerContainer}>
            <Text style={styles.qaAnswerLabel}>{t("agentPanel.stream.answerLabel")}</Text>
            <MarkdownRenderer text={entry.answer} compact enableHtmlish={false} />
          </View>
        )}
      </View>
    ) : (
      <View>
        <Text selectable style={styles.body} numberOfLines={6}>
          {entry.text}
        </Text>
        {entry.kind === "q_and_a" && entry.answer && (
          <View style={styles.qaAnswerContainer}>
            <Text style={styles.qaAnswerLabel}>{t("agentPanel.stream.answerLabel")}</Text>
            <Text selectable style={styles.body} numberOfLines={6}>
              {entry.answer}
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View
      style={[styles.card, pending && styles.pendingCard]}
      testID={`companion-entry-${entry.id}`}
    >
      <View style={styles.entryHeaderRow}>
        <Text style={styles.eyebrow}>{formatMessageTimestamp(new Date(entry.timestamp))}</Text>
        {entry.kind === "pin" ? (
          <Button variant="ghost" size="sm" onPress={handleRemovePinLocal} disabled={disabled}>
            <Text style={styles.description}>{t("agentPanel.stream.unpin")}</Text>
          </Button>
        ) : null}
      </View>

      <Text style={styles.title}>{title}</Text>
      {status ? (
        <Text style={[styles.description, pending && styles.pendingText]}>{status}</Text>
      ) : null}

      {body}
      {entry.messageReview ? (
        <View style={styles.notice}>
          <Text selectable style={styles.description}>
            {entry.messageReview.state === "unreviewed"
              ? "This retained message may contain multiple asks. None are assumed complete. Ask your agent to inventory it using list_stream_asks and review_stream_message."
              : entry.messageReview.note}
          </Text>
          <Text selectable style={styles.description}>
            {entry.messageReview.askIds.length} linked asks · Source: {entry.source?.messageId}
          </Text>
        </View>
      ) : null}
      {entry.ask ? (
        <View style={styles.notice}>
          {entry.ask.subtasks?.length ? (
            <Text style={styles.description}>
              {entry.ask.subtasks.filter((task) => task.done).length} / {entry.ask.subtasks.length}{" "}
              subtasks done
            </Text>
          ) : null}
          {entry.ask.subtasks?.map((task) => (
            <Text key={task.id} style={styles.body}>
              {task.done ? "✓" : "○"} {task.text}
            </Text>
          ))}
          <Text selectable style={styles.description}>
            {entry.ask.state === "done" ? "Completion evidence" : "Evidence so far"}:{" "}
            {entry.ask.evidence || "None recorded"}
          </Text>
          {entry.ask.state !== "done" ? (
            <Text selectable style={styles.body}>
              Remaining: {entry.ask.remaining || "Not yet specified"}
            </Text>
          ) : null}
          {entry.ask.sourceMessageId ? (
            <Text selectable style={styles.description}>
              Source message: {entry.ask.sourceMessageId}
            </Text>
          ) : null}
          {entry.ask.delegatedAgentId && serverId ? (
            <Button variant="outline" onPress={openDelegated}>
              Open delegated session
            </Button>
          ) : null}
        </View>
      ) : null}

      {entry.source && onOpenSource ? (
        <Button variant="outline" onPress={openSource}>
          Open source message in Chat
        </Button>
      ) : null}
      {entry.truncated ? (
        <Text style={styles.description}>{t("agentPanel.stream.excerpt")}</Text>
      ) : null}

      <View style={styles.actions}>
        {entry.text ? (
          <Button
            variant="ghost"
            style={styles.touchTarget}
            onPress={toggleExpanded}
            accessibilityState={expandedAccessibilityState}
          >
            {t(expanded ? "agentPanel.stream.showLess" : "agentPanel.stream.read")}
          </Button>
        ) : null}
        <Button
          variant={pending ? "secondary" : "outline"}
          style={styles.touchTarget}
          onPress={pending ? onReplyInChat : onReturnToChat}
        >
          {t(pending ? "agentPanel.stream.replyInChat" : "agentPanel.stream.backToChat")}
        </Button>

        {!entry.messageReview &&
          (entry.kind === "question" || entry.kind === "feature_request") && (
            <View style={styles.statusActionsRow}>
              <Button variant="outline" onPress={handleSetOpen} disabled={disabled}>
                Open
              </Button>
              <Button variant="outline" onPress={handleSetReviewed} disabled={disabled}>
                {entry.ask ? "In progress" : "Reviewed"}
              </Button>
              <Button
                variant="outline"
                onPress={handleSetDone}
                disabled={disabled || Boolean(entry.ask)}
              >
                Done
              </Button>
            </View>
          )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.surface0 },
  feed: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: theme.spacing[4],
    paddingTop: theme.spacing[12],
  },
  header: { gap: theme.spacing[2], paddingBottom: theme.spacing[6] },
  notice: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  eyebrow: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.sm },
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
  body: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
    marginTop: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  touchTarget: { minHeight: 44 },
  empty: { gap: theme.spacing[3], paddingVertical: theme.spacing[6] },
  separator: { height: theme.spacing[3] },
  footer: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[6],
  },
  segmentContainer: { gap: theme.spacing[2], marginTop: theme.spacing[2] },
  pinInputContainer: { flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[2] },
  pinInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
  },
  qaAnswerContainer: {
    marginTop: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  qaAnswerLabel: {
    fontWeight: "bold",
    marginBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  entryHeaderRow: { flexDirection: "row", justifyContent: "space-between" },
  statusActionsRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
    width: "100%",
  },
}));

function StreamFilters({
  status,
  setStatus,
  sourceRole,
  setSourceRole,
  viewTab,
  counts,
  resetFilters,
}: {
  status: "all" | "open" | "done";
  setStatus: (value: "all" | "open" | "done") => void;
  sourceRole: "all" | "user" | "agent";
  setSourceRole: (value: "all" | "user" | "agent") => void;
  viewTab: ViewTab;
  counts: ReturnType<typeof useGlobalStream>["counts"];
  resetFilters: () => void;
}) {
  return (
    <View style={styles.segmentContainer}>
      <Text style={styles.description}>Status</Text>
      <SegmentedControl
        value={status}
        onValueChange={setStatus}
        testID="stream-status-filter"
        options={[
          { value: "all", label: `All${counts ? ` (${counts.total})` : ""}` },
          { value: "open", label: `Open${counts ? ` (${counts.open})` : ""}` },
          {
            value: "done",
            label: `${viewTab === "checklist" ? "Done" : "Closed"}${counts ? ` (${counts.done})` : ""}`,
          },
        ]}
      />
      <Text style={styles.description}>Source</Text>
      <SegmentedControl
        value={sourceRole}
        onValueChange={setSourceRole}
        textWrap
        testID="stream-source-filter"
        options={[
          { value: "all", label: "All sources" },
          { value: "user", label: "Your messages" },
          { value: "agent", label: "Agent messages" },
        ]}
      />
      {counts ? (
        <Text style={styles.description}>
          {counts.open} open; {counts.total - counts.open} other items · {counts.matching} match
          these filters
          {counts.unknown ? ` · ${counts.unknown} without source attribution` : ""}
        </Text>
      ) : null}
      {status !== "all" || sourceRole !== "all" ? (
        <Button variant="outline" onPress={resetFilters}>
          Clear filters
        </Button>
      ) : null}
    </View>
  );
}

function emptyStreamLabel(
  loading: boolean,
  connection: string,
  notices: number,
  total: number | undefined,
  viewTab: ViewTab,
): string {
  if (loading) return "Loading Stream…";
  if (connection !== "online") return "Host offline";
  if (notices) return "Stream could not load";
  if (total) return "No items match these filters";
  if (viewTab === "checklist") return "No confirmed asks or unreviewed messages captured yet";
  return "No captured activity yet";
}
