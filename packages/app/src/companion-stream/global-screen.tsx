import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import {
  useHosts,
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useSessionStore } from "@/stores/session-store";
import { useAgentViewStore } from "@/stores/agent-view-store";
import type { ChatJumpTarget } from "@/agent-stream/use-timeline-anchor-jump";
import { buildReplyQuote } from "@/components/reply/composer-quote";
import { EntryCard } from "./entry-card";
import { TagCloud } from "./tag-cloud";
import { useGlobalStream, type GlobalStreamRow } from "./use-global-stream";
import { useStreamTagFilter } from "./use-stream-tag-filter";
import { useApplyStreamFocus } from "./use-stream-focus";
import { streamCardSource, hasUnseenReply } from "./card-source";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { WorkflowArtifact } from "./workflow-artifact";
import { WorkflowComposer } from "./workflow-composer";
import { parseWorkflowView, type WorkflowView } from "./workflow-view";
import { useStreamReturnStore } from "./stream-return";
import { splitLater } from "./needs-you-later";

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const KEEP_VISIBLE_CONTENT = { minIndexForVisible: 0 };
const rowKey = (row: GlobalStreamRow) => JSON.stringify([row.serverId, row.id]);

export function GlobalStreamScreen() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const navigateView = useCallback((next: WorkflowView) => router.setParams({ view: next }), []);
  return <StreamWorkflowFeed initialView={parseWorkflowView(view)} onViewChange={navigateView} />;
}

export interface WorkflowScope {
  serverId: string;
  agentId: string;
}
export interface WorkflowLocalContext extends WorkflowScope {
  cwd: string;
  artifactsSupported: boolean;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
  onReturnToChat: () => void;
  onReplyInChat: () => void;
}

/** Global and local views query the same canonical rows. Scope never owns another task store. */
export function StreamWorkflowFeed({
  initialView = "activity",
  scope,
  onViewChange,
  localContext,
}: {
  onViewChange?: (view: WorkflowView) => void;
  initialView?: WorkflowView;
  scope?: WorkflowScope;
  localContext?: WorkflowLocalContext;
}) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const panelActive = useRetainedPanelActive();
  const hosts = useHosts();
  const [host, setHost] = useState(ALL_HOSTS_OPTION_ID);
  const [view, setView] = useState<WorkflowView>(initialView);
  const [local, setLocal] = useState(Boolean(scope));
  const [search, setSearch] = useState("");
  // The search field is uncontrolled; a new key shows a search set from outside it.
  const [searchKey, setSearchKey] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(true);
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [showLater, setShowLater] = useState(false);
  // Navigation into Needs you updates the existing screen, without resetting search or drafts.
  useEffect(() => setView(initialView), [initialView]);
  // Back on the Stream, the chat it opened no longer offers the way back here.
  const clearStreamReturn = useStreamReturnStore((state) => state.clear);
  useEffect(() => {
    if (!scope && focused) clearStreamReturn();
  }, [scope, focused, clearStreamReturn]);
  // Chat's floating pane opens an ask's card: this chat's Tasks, searched down to it.
  useApplyStreamFocus(scope, (focus) => {
    setView("tasks");
    setLocal(true);
    setUnresolvedOnly(false);
    setTags([]);
    setSearch(focus.query);
    setSearchKey((value) => value + 1);
  });
  const localScope = local ? scope : undefined;
  const query = useGlobalStream({
    serverId: host === ALL_HOSTS_OPTION_ID ? null : host,
    view,
    filter: view === "tasks" && unresolvedOnly ? "pending" : "all",
    relatedAgentId: localScope?.agentId,
    relatedServerId: localScope?.serverId,
    search: useDebouncedValue(search, 250),
    tags,
    includeArchived,
    enabled: focused && panelActive,
  });
  const tagFilter = useStreamTagFilter(query, setTags);
  const tagPress = query.supportsTags ? tagFilter.add : undefined;
  const {
    refetch,
    fetchNextPage,
    isFetching,
    notices,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
  } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const loadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const toggleUnresolved = useCallback(() => setUnresolvedOnly((value) => !value), []);
  const toggleArchived = useCallback(() => setIncludeArchived((value) => !value), []);
  const toggleScope = useCallback(() => setLocal((value) => !value), []);
  const showNow = useCallback(() => setShowLater(false), []);
  const showLaterRows = useCallback(() => setShowLater(true), []);
  const { rows: queryRows } = query;
  const { data, nowCount, laterCount, showingLater } = useMemo(
    () => splitLater(queryRows, view, showLater),
    [view, queryRows, showLater],
  );
  const chooseView = useCallback(
    (next: WorkflowView) => {
      setView(next);
      onViewChange?.(next);
    },
    [onViewChange],
  );
  const showNeedsYou = useCallback(() => chooseView("needs_you"), [chooseView]);
  const needsYouSelected = useMemo(() => ({ selected: view === "needs_you" }), [view]);
  const knownTags = useMemo(() => query.tagCounts.map((item) => item.tag), [query.tagCounts]);
  const returnView = scope ? undefined : view;
  const renderItem = useCallback(
    ({ item }: { item: GlobalStreamRow }) => (
      <GlobalStreamCard
        row={item}
        onSaved={refresh}
        onTagPress={tagPress}
        localContext={localContext}
        returnView={returnView}
      />
    ),
    [refresh, tagPress, localContext, returnView],
  );
  const tabs = useMemo(
    () => [
      { value: "activity" as const, label: t("globalStream.activity") },
      { value: "tasks" as const, label: t("globalStream.tasks") },
      { value: "questions" as const, label: t("globalStream.questions") },
      { value: "saved" as const, label: t("globalStream.saved") },
    ],
    [t],
  );
  const header = useMemo(
    () => (
      <View style={styles.header}>
        <View style={styles.controls}>
          <Button
            size="sm"
            variant={view === "needs_you" ? "secondary" : "ghost"}
            onPress={showNeedsYou}
            accessibilityState={needsYouSelected}
            testID="stream-needs-you"
          >
            {t("globalStream.needsYou")}
          </Button>
          <SegmentedControl
            value={view}
            onValueChange={chooseView}
            options={tabs}
            size="sm"
            textWrap
            testID="stream-workflow-views"
          />
          {scope ? (
            <Button size="sm" variant="ghost" onPress={toggleScope} testID="stream-scope">
              {t(local ? "globalStream.thisChat" : "globalStream.allSessions")}
            </Button>
          ) : null}
        </View>
        <View style={styles.controls}>
          <View style={styles.search}>
            <SearchField
              key={searchKey}
              value={search}
              onChangeText={setSearch}
              placeholder={t("globalStream.search")}
              clearAccessibilityLabel={t("globalStream.clearSearch")}
              testID="global-stream-search"
            />
          </View>
          <HostFilter
            hosts={hosts}
            selectedHost={host}
            onSelectHost={setHost}
            triggerTestID="global-stream-host"
          />
          {view === "tasks" ? (
            <Button
              size="sm"
              variant={unresolvedOnly ? "secondary" : "ghost"}
              onPress={toggleUnresolved}
            >
              {t(
                unresolvedOnly
                  ? "agentPanel.stream.showCompleted"
                  : "agentPanel.stream.showUnresolved",
              )}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={includeArchived ? "secondary" : "ghost"}
            onPress={toggleArchived}
          >
            {t("globalStream.archived")}
          </Button>
          <Button size="sm" variant="ghost" onPress={refresh} disabled={isFetching}>
            {t("globalStream.refresh")}
          </Button>
        </View>
        {laterCount > 0 ? (
          <NowLaterSwitch
            nowCount={nowCount}
            laterCount={laterCount}
            showingLater={showingLater}
            onShowNow={showNow}
            onShowLater={showLaterRows}
          />
        ) : null}
        {/* Tags organise saved knowledge; in Needs you they only show once one is in use. */}
        {query.supportsTags && (view !== "needs_you" || tags.length > 0) ? (
          <TagCloud
            counts={query.tagCounts}
            pinned={query.pinnedTags}
            active={tags}
            onToggle={tagFilter.toggle}
            onTogglePin={tagFilter.setPinned}
            error={tagFilter.error}
          />
        ) : null}
        {scope ? (
          <WorkflowComposer
            scope={scope}
            view={view}
            visible={local}
            onSaved={refresh}
            supportsTags={query.supportsTags}
            knownTags={knownTags}
          />
        ) : null}
        {hasNextPage ? (
          <Text style={styles.description} testID="stream-loaded-count">
            {t("globalStream.partialCount", { count: query.rows.length })}
          </Text>
        ) : null}
        {notices.map((notice) => (
          <Text key={notice} style={styles.notice} accessibilityRole="alert">
            {notice}
          </Text>
        ))}
      </View>
    ),
    [
      t,
      view,
      nowCount,
      laterCount,
      showingLater,
      showNow,
      showLaterRows,
      showNeedsYou,
      chooseView,
      needsYouSelected,
      knownTags,
      scope,
      toggleScope,
      local,
      search,
      tabs,
      tags,
      query.supportsTags,
      query.tagCounts,
      query.pinnedTags,
      query.rows.length,
      tagFilter.toggle,
      tagFilter.setPinned,
      tagFilter.error,
      searchKey,
      hosts,
      host,
      includeArchived,
      toggleArchived,
      unresolvedOnly,
      toggleUnresolved,
      refresh,
      isFetching,
      hasNextPage,
      notices,
    ],
  );
  const empty = useMemo(
    () =>
      isLoading ? (
        <ThemedSpinner />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.empty}>
            {t(notices.length ? "globalStream.incomplete" : "globalStream.empty")}
          </Text>
          {/* What each view holds is explained where there is room for it: the empty list. */}
          <Text style={styles.description}>
            {t(
              view === "needs_you"
                ? "globalStream.needsYouDescription"
                : "globalStream.scopeDescription",
            )}
          </Text>
        </View>
      ),
    [isLoading, notices.length, t, view],
  );
  const footer = useMemo(
    () =>
      hasNextPage ? (
        <Button onPress={loadMore} disabled={isFetchingNextPage}>
          {t("globalStream.more")}
        </Button>
      ) : null,
    [hasNextPage, loadMore, isFetchingNextPage, t],
  );
  return (
    <View style={styles.root} testID={scope ? "local-stream-workflow" : "global-stream"}>
      {!scope ? (
        <MenuHeader
          title={t(view === "needs_you" ? "globalStream.needsYou" : "globalStream.title")}
        />
      ) : null}
      <FlatList
        data={data}
        maintainVisibleContentPosition={KEEP_VISIBLE_CONTENT}
        keyExtractor={rowKey}
        renderItem={renderItem}
        contentContainerStyle={styles.feed}
        keyboardShouldPersistTaps="handled"
        refreshing={isFetching && !isFetchingNextPage}
        onRefresh={refresh}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
      />
    </View>
  );
}

/** Needs you: what is waiting now, or what was set aside for later. Always in the header. */
function NowLaterSwitch({
  nowCount,
  laterCount,
  showingLater,
  onShowNow,
  onShowLater,
}: {
  nowCount: number;
  laterCount: number;
  showingLater: boolean;
  onShowNow: () => void;
  onShowLater: () => void;
}) {
  const { t } = useTranslation();
  const nowState = useMemo(() => ({ selected: !showingLater }), [showingLater]);
  const laterState = useMemo(() => ({ selected: showingLater }), [showingLater]);
  return (
    <View style={styles.controls} testID="stream-now-later">
      <Button
        size="sm"
        variant={showingLater ? "ghost" : "secondary"}
        onPress={onShowNow}
        accessibilityState={nowState}
        testID="stream-show-now"
      >
        {t("globalStream.now", { count: nowCount })}
      </Button>
      <Button
        size="sm"
        variant={showingLater ? "secondary" : "ghost"}
        onPress={onShowLater}
        accessibilityState={laterState}
        testID="stream-show-later"
      >
        {t("globalStream.later", { count: laterCount })}
      </Button>
    </View>
  );
}

export function GlobalStreamCard({
  row,
  onSaved,
  onTagPress,
  localContext,
  returnView,
}: {
  row: GlobalStreamRow;
  onSaved: () => void;
  onTagPress?: (tag: string) => void;
  localContext?: WorkflowLocalContext;
  /** The Stream view showing this card; a chat opened from it offers the way back. */
  returnView?: WorkflowView;
}) {
  const { t } = useTranslation();
  const {
    entry,
    copiedTask,
    serverId: sourceServerId,
    agentId: sourceAgentId,
    workspaceId: sourceWorkspaceId,
  } = streamCardSource(row);
  const localSource = localContextForSource(localContext, sourceServerId, sourceAgentId);
  const client = useHostRuntimeClient(row.serverId);
  const connection = useHostRuntimeConnectionStatus(row.serverId);
  const supportsWrites = useSessionStore(
    (state) => state.sessions[row.serverId]?.serverInfo?.features?.globalStream === true,
  );
  const supportsAnswers = useSessionStore(
    (state) => state.sessions[row.serverId]?.serverInfo?.features?.streamAnswers === true,
  );
  const supportsDefer = useSessionStore(
    (state) => state.sessions[row.serverId]?.serverInfo?.features?.streamDefer === true,
  );
  // Without the daemon queue a plain send would interrupt a busy agent; reply in Chat instead.
  const supportsQueuedReply = useSessionStore(
    (state) => state.sessions[row.serverId]?.serverInfo?.features?.agentMessageQueue === true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStreamReturn = useStreamReturnStore((state) => state.setTarget);
  const rememberReturn = useCallback(
    (serverId: string, agentId: string) => {
      if (returnView) setStreamReturn({ serverId, agentId, view: returnView });
    },
    [returnView, setStreamReturn],
  );
  const openChat = useCallback(() => {
    if (localSource) {
      localSource.onReturnToChat();
      return;
    }
    rememberReturn(sourceServerId, sourceAgentId);
    navigateToAgent({
      serverId: sourceServerId,
      agentId: sourceAgentId,
      workspaceId: sourceWorkspaceId,
    });
  }, [localSource, rememberReturn, sourceServerId, sourceAgentId, sourceWorkspaceId]);
  const requestReplyQuote = useAgentViewStore((state) => state.requestReplyQuote);
  // The reply goes to the task's own chat, which openChat opens for a copied task too.
  const replyInChat = useCallback(
    (replyTo: CompanionEntry) => {
      requestReplyQuote(sourceServerId, sourceAgentId, replyTo.text);
      if (localSource) localSource.onReplyInChat();
      else openChat();
    },
    [localSource, openChat, requestReplyQuote, sourceServerId, sourceAgentId],
  );
  const openChatAt = useAgentViewStore((state) => state.openChatAt);
  // A copied task's place is in its origin chat, which this row cannot address.
  const showInChat = useCallback(
    (target: ChatJumpTarget) => {
      openChatAt(row.serverId, row.agentId, target);
      if (!localSource) {
        rememberReturn(row.serverId, row.agentId);
        navigateToAgent({
          serverId: row.serverId,
          agentId: row.agentId,
          workspaceId: row.workspaceId,
        });
      }
    },
    [localSource, openChatAt, rememberReturn, row.serverId, row.agentId, row.workspaceId],
  );
  // Answer from the card: the reply quotes what it answers, as Reply in chat would.
  const sendReply = useCallback(
    async (replyTo: CompanionEntry, text: string) => {
      if (!client || connection !== "online") throw new Error(t("globalStream.saveFailed"));
      const quoted = buildReplyQuote(replyTo.text);
      const result = await client.sendAgentMessage(
        row.agentId,
        quoted ? `${quoted}\n\n${text}` : text,
        { messageId: globalThis.crypto.randomUUID() },
      );
      return { queued: result.queued };
    },
    [client, connection, row.agentId, t],
  );
  const update = useCallback(
    async (entryId: string, status?: "open" | "reviewed" | "done") => {
      if (!client || connection !== "online" || !supportsWrites || busy || copiedTask) return;
      setBusy(true);
      setError(null);
      try {
        await client.updateStreamEntry({
          agentId: row.agentId,
          entryId,
          action: status ? "update_status" : "remove_pin",
          expectedRevision: row.item.kind === "entry" ? row.item.entry.ask?.revision : undefined,
          status,
        });
        onSaved();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t("globalStream.saveFailed"));
      } finally {
        setBusy(false);
      }
    },
    [client, connection, supportsWrites, busy, copiedTask, row.agentId, row.item, onSaved, t],
  );
  const updateStatus = useCallback(
    (id: string, status: "open" | "reviewed" | "done") => {
      void update(id, status);
    },
    [update],
  );
  const removePin = useCallback(
    (id: string) => {
      void update(id);
    },
    [update],
  );
  const setDeferred = useCallback(
    async (entryId: string, deferred: boolean) => {
      if (!client || connection !== "online" || busy || copiedTask) return;
      setBusy(true);
      setError(null);
      try {
        await client.updateStreamEntry({
          agentId: row.agentId,
          entryId,
          action: "set_deferred",
          deferred,
        });
        onSaved();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t("globalStream.saveFailed"));
      } finally {
        setBusy(false);
      }
    },
    [client, connection, busy, copiedTask, row.agentId, onSaved, t],
  );
  const defer = useCallback(
    (entryId: string, deferred: boolean) => {
      void setDeferred(entryId, deferred);
    },
    [setDeferred],
  );
  const unseenAnswer = hasUnseenReply(entry);
  const markAnswerSeen = useCallback(async () => {
    if (
      !entry?.reply ||
      !client ||
      connection !== "online" ||
      !supportsAnswers ||
      busy ||
      copiedTask
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await client.updateStreamEntry({
        agentId: row.agentId,
        entryId: entry.id,
        action: "mark_reply_seen",
        replyRevision: entry.reply.revision,
      });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("globalStream.saveFailed"));
    } finally {
      setBusy(false);
    }
  }, [entry, client, connection, supportsAnswers, busy, copiedTask, row.agentId, onSaved, t]);
  return (
    <View style={styles.row} testID={`global-stream-row-${row.agentId}`}>
      <CardSourceLine
        row={row}
        copiedTask={copiedTask}
        sourceServerId={sourceServerId}
        onOpen={openChat}
      />
      {copiedTask ? (
        <Text style={styles.notice} accessibilityRole="alert">
          {t("globalStream.copiedTask")}
        </Text>
      ) : null}
      {row.item.kind === "entry" ? (
        <EntryCard
          entry={row.item.entry}
          serverId={row.serverId}
          onReturnToChat={openChat}
          onReplyInChat={replyInChat}
          onShowInChat={copiedTask ? undefined : showInChat}
          onUpdateStatus={updateStatus}
          onRemovePin={removePin}
          onTagPress={onTagPress}
          onSendReply={supportsQueuedReply && !copiedTask ? sendReply : undefined}
          onDefer={supportsDefer && !copiedTask ? defer : undefined}
          disabled={busy || copiedTask || connection !== "online" || !supportsWrites}
        />
      ) : (
        <WorkflowArtifact
          artifact={row.item.artifact}
          row={row}
          localContext={localContext}
          onOpenChat={openChat}
          onSaved={onSaved}
        />
      )}
      {unseenAnswer && supportsAnswers ? (
        <Button
          variant="ghost"
          size="sm"
          style={styles.inlineAction}
          onPress={markAnswerSeen}
          disabled={busy || copiedTask || connection !== "online"}
          testID="stream-mark-answer-seen"
        >
          {t("agentPanel.stream.answers.markSeen")}
        </Button>
      ) : null}
      {busy ? <Text style={styles.description}>{t("globalStream.saving")}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** One muted line says where the card is from; the chat title opens it. */
function CardSourceLine({
  row,
  copiedTask,
  sourceServerId,
  onOpen,
}: {
  row: GlobalStreamRow;
  copiedTask: boolean;
  sourceServerId: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.sourceLine}>
      <Pressable onPress={onOpen} accessibilityRole="button" style={styles.sourcePress}>
        <Text style={styles.source} numberOfLines={1}>
          {copiedTask ? t("globalStream.openTaskSource") : row.agentTitle}
        </Text>
      </Pressable>
      <Text style={styles.path} numberOfLines={1}>
        {copiedTask ? sourceServerId : row.serverLabel}
        {row.archived ? ` · ${t("globalStream.archived")}` : ""}
        {row.cwd ? ` · ${row.cwd}` : ""}
      </Text>
    </View>
  );
}

function localContextForSource(
  context: WorkflowLocalContext | undefined,
  serverId: string,
  agentId: string,
) {
  return context?.serverId === serverId && context.agentId === agentId ? context : undefined;
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.surface0 },
  feed: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    padding: theme.spacing[4],
    paddingBottom: theme.spacing[8],
  },
  header: { gap: theme.spacing[2], marginBottom: theme.spacing[4] },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  search: { flexGrow: 1, flexBasis: 220 },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  notice: { color: theme.colors.statusWarning, fontSize: theme.fontSize.sm },
  row: { gap: theme.spacing[1], marginBottom: theme.spacing[4] },
  sourceLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
  },
  sourcePress: { flexShrink: 1, maxWidth: "60%" },
  source: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  path: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  inlineAction: { alignSelf: "flex-start" },
  emptyState: { gap: theme.spacing[2], paddingVertical: theme.spacing[8] },
  artifact: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
  },
  artifactPath: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
}));
