import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
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
  // Navigation into Needs you updates the existing screen, without resetting search or drafts.
  useEffect(() => setView(initialView), [initialView]);
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
  const renderItem = useCallback(
    ({ item }: { item: GlobalStreamRow }) => (
      <GlobalStreamCard
        row={item}
        onSaved={refresh}
        onTagPress={tagPress}
        localContext={localContext}
      />
    ),
    [refresh, tagPress, localContext],
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
            variant={view === "needs_you" ? "secondary" : "outline"}
            onPress={showNeedsYou}
            accessibilityState={needsYouSelected}
            testID="stream-needs-you"
          >
            {t("globalStream.needsYou")}
          </Button>
          {scope ? (
            <Button variant="ghost" onPress={toggleScope} testID="stream-scope">
              {t(local ? "globalStream.thisChat" : "globalStream.allSessions")}
            </Button>
          ) : (
            <Text style={styles.description}>{t("globalStream.allSessions")}</Text>
          )}
        </View>
        <Text style={styles.description}>
          {t(
            view === "needs_you"
              ? "globalStream.needsYouDescription"
              : "globalStream.scopeDescription",
          )}
        </Text>
        <SegmentedControl
          value={view}
          onValueChange={chooseView}
          options={tabs}
          textWrap
          testID="stream-workflow-views"
        />
        <SearchField
          key={searchKey}
          value={search}
          onChangeText={setSearch}
          placeholder={t("globalStream.search")}
          clearAccessibilityLabel={t("globalStream.clearSearch")}
          testID="global-stream-search"
        />
        {query.supportsTags ? (
          <TagCloud
            counts={query.tagCounts}
            pinned={query.pinnedTags}
            active={tags}
            onToggle={tagFilter.toggle}
            onTogglePin={tagFilter.setPinned}
            error={tagFilter.error}
          />
        ) : null}
        <View style={styles.controls}>
          <HostFilter
            hosts={hosts}
            selectedHost={host}
            onSelectHost={setHost}
            triggerTestID="global-stream-host"
          />
          {view === "tasks" ? (
            <Button variant={unresolvedOnly ? "secondary" : "ghost"} onPress={toggleUnresolved}>
              {t(
                unresolvedOnly
                  ? "agentPanel.stream.showCompleted"
                  : "agentPanel.stream.showUnresolved",
              )}
            </Button>
          ) : null}
          <Button variant={includeArchived ? "secondary" : "ghost"} onPress={toggleArchived}>
            {t("globalStream.archived")}
          </Button>
          <Button variant="ghost" onPress={refresh} disabled={isFetching}>
            {t("globalStream.refresh")}
          </Button>
        </View>
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
        <Text style={styles.description} testID="stream-loaded-count">
          {t(hasNextPage ? "globalStream.partialCount" : "globalStream.loadedCount", {
            count: query.rows.length,
          })}
        </Text>
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
        <Text style={styles.empty}>
          {t(notices.length ? "globalStream.incomplete" : "globalStream.empty")}
        </Text>
      ),
    [isLoading, notices.length, t],
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
        data={query.rows}
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

export function GlobalStreamCard({
  row,
  onSaved,
  onTagPress,
  localContext,
}: {
  row: GlobalStreamRow;
  onSaved: () => void;
  onTagPress?: (tag: string) => void;
  localContext?: WorkflowLocalContext;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openChat = useCallback(() => {
    if (localSource) {
      localSource.onReturnToChat();
      return;
    }
    navigateToAgent({
      serverId: sourceServerId,
      agentId: sourceAgentId,
      workspaceId: sourceWorkspaceId,
    });
  }, [localSource, sourceServerId, sourceAgentId, sourceWorkspaceId]);
  const replyInChat = localSource?.onReplyInChat ?? openChat;
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
      <Button variant="ghost" onPress={openChat} style={styles.source}>
        {copiedTask ? t("globalStream.openTaskSource") : row.agentTitle} ·{" "}
        {copiedTask ? sourceServerId : row.serverLabel}
        {row.archived ? ` · ${t("globalStream.archived")}` : ""}
      </Button>
      {copiedTask ? (
        <Text style={styles.notice} accessibilityRole="alert">
          {t("globalStream.copiedTask")}
        </Text>
      ) : null}
      <Text style={styles.path} numberOfLines={1}>
        {row.cwd}
      </Text>
      {row.item.kind === "entry" ? (
        <EntryCard
          entry={row.item.entry}
          serverId={row.serverId}
          onReturnToChat={openChat}
          onReplyInChat={replyInChat}
          onUpdateStatus={updateStatus}
          onRemovePin={removePin}
          onTagPress={onTagPress}
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
          variant="outline"
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
  header: { gap: theme.spacing[3], marginBottom: theme.spacing[6] },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  notice: { color: theme.colors.statusWarning, fontSize: theme.fontSize.sm },
  row: { gap: theme.spacing[2], marginBottom: theme.spacing[6] },
  source: { alignSelf: "flex-start", minHeight: 44, maxWidth: "100%" },
  path: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[1],
  },
  artifact: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
  },
  artifactPath: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  empty: {
    color: theme.colors.foregroundMuted,
    paddingVertical: theme.spacing[8],
    fontSize: theme.fontSize.base,
  },
}));
