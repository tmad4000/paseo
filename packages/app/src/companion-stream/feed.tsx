import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import { isCompanionEntryPending, type CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ArtifactCard, ArtifactFeed } from "@/artifacts/feed";
import { useSessionStore } from "@/stores/session-store";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SearchField } from "@/components/ui/search-field";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useHostRuntimeConnectionStatus, useHostRuntimeClient } from "@/runtime/host-runtime";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { buildCompanionFeed, type CompanionFeedItem } from "./model";
import { useGlobalStream } from "./use-global-stream";
import { ArtifactPinOperations } from "./artifact-pin-operations";
import { EntryCard } from "./entry-card";
import { TagCloud } from "./tag-cloud";
import { StreamNoteComposer } from "./note-composer";
import { useStreamTagFilter } from "./use-stream-tag-filter";

export { EntryCard } from "./entry-card";

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
}

const keyExtractor = (item: CompanionFeedItem) => item.id;
const NO_NOTICES: readonly string[] = [];

type ViewTab = "checklist" | "stream" | "pinned";
type StreamFilter = "all" | "question" | "feature_request" | "permission" | "outcome" | "q_and_a";

export function CompanionFeed({
  serverId,
  agentId,
  cwd,
  entries,
  artifacts,
  isSupported,
  artifactsSupported,
  onOpenWorkspaceFile,
  onReturnToChat,
  onReplyInChat,
}: CompanionFeedProps) {
  const { t } = useTranslation();
  const connection = useHostRuntimeConnectionStatus(serverId);
  const client = useHostRuntimeClient(serverId);
  const supportsWrites = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.globalStream === true,
  );
  // COMPAT(durableStream): added in fork beta.11; remove after 2027-04-07 once host floor includes durable Stream.
  const supportsDurableStream = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.durableStream === true,
  );
  // Until server_info arrives the host is unknown, not unsupported. Older or unknown hosts get the
  // per-chat entries carried on the agent snapshot instead of a blocking "update the host" screen.
  const hostKnown = useSessionStore((state) => Boolean(state.sessions[serverId]?.serverInfo));
  const hostName = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.hostname ?? serverId,
  );
  const hostVersion = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.version ?? "?",
  );
  const olderHost = hostKnown && !supportsDurableStream;
  const [saving, setSaving] = useState(false);
  const artifactPins = useRef(new ArtifactPinOperations());
  const [saveError, setSaveError] = useState<string | null>(null);

  const [viewTab, setViewTab] = useState<ViewTab>("stream");
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const pendingFilter = onlyOpen ? "pending" : "all";
  const query = useGlobalStream({
    serverId,
    agentId,
    asksOnly: viewTab === "checklist",
    filter: viewTab === "pinned" ? "pinned" : pendingFilter,
    search: useDebouncedValue(search, 250),
    tags,
    includeArchived: true,
    enabled: isSupported && supportsDurableStream,
  });
  const tagFilter = useStreamTagFilter(query, setTags);
  const knownTags = useMemo(() => query.tagCounts.map((item) => item.tag), [query.tagCounts]);
  const { refetch, fetchNextPage } = query;
  // Global-Stream notices describe the durable query, which older hosts never run.
  const notices = supportsDurableStream ? query.notices : NO_NOTICES;
  const items = useMemo(
    () =>
      supportsDurableStream
        ? buildCompanionFeed(
            query.rows.flatMap((row) => (row.item.kind === "entry" ? [row.item.entry] : [])),
            query.rows.flatMap((row) => (row.item.kind === "artifact" ? [row.item.artifact] : [])),
          )
        : buildCompanionFeed(entries, artifacts),
    [supportsDurableStream, query.rows, entries, artifacts],
  );
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const loadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (viewTab === "pinned") {
        return item.kind === "entry" && item.entry.kind === "pin";
      } else {
        // Stream / Queue
        if (item.kind === "entry" && item.entry.kind === "pin")
          return viewTab === "stream" && filter === "all" && !onlyOpen;

        if (item.kind === "artifact") {
          return filter === "all" && !onlyOpen;
        }

        if (viewTab !== "checklist" && filter !== "all" && item.entry.kind !== filter) return false;
        // The durable query filters to explicit asks; legacy entries need the same rule here.
        if (viewTab === "checklist" && !supportsDurableStream && !item.entry.ask) return false;

        if (onlyOpen) {
          if (item.entry.kind === "question" || item.entry.kind === "feature_request") {
            return isCompanionEntryPending(item.entry);
          }
          if (item.entry.kind === "permission") {
            return item.entry.status === "pending";
          }
          return false;
        }

        return true;
      }
    });
  }, [items, viewTab, filter, onlyOpen, supportsDurableStream]);

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
    (entryId: string, status: "open" | "reviewed" | "done") => {
      const entry = items.find((item) => item.id === entryId);
      const expectedRevision = entry?.kind === "entry" ? entry.entry.ask?.revision : undefined;
      void save({ agentId, entryId, action: "update_status", status, expectedRevision }).catch(
        () => undefined,
      );
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
          onUpdateStatus={handleUpdateStatus}
          onRemovePin={handleRemovePin}
          onTagPress={query.supportsTags ? tagFilter.add : undefined}
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
      handleUpdateStatus,
      handleRemovePin,
      saving,
      supportsWrites,
      connection,
      query.supportsTags,
      tagFilter.add,
    ],
  );

  const handleToggleOnlyOpen = useCallback(() => setOnlyOpen((v) => !v), []);
  const handleSubmitNote = useCallback(
    ({ entryId, text }: { entryId: string; text: string }) =>
      save({
        agentId,
        action: ({ pinned: "add_pin", checklist: "set_ask", stream: "add_question" } as const)[
          viewTab
        ],
        ...(viewTab === "checklist"
          ? { expectedRevision: 0, ask: { state: "open" as const, remaining: "", evidence: "" } }
          : {}),
        entryId,
        text,
      }),
    [save, agentId, viewTab],
  );

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <Text style={styles.title}>{t("agentPanel.stream.title")}</Text>
        <Text style={styles.description}>{t("agentPanel.stream.description")}</Text>

        {olderHost ? (
          <View style={styles.notice} testID="companion-stream-older-host">
            <Text style={styles.description}>
              {t("agentPanel.stream.olderHost", { host: hostName, version: hostVersion })}
            </Text>
          </View>
        ) : null}

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
            { value: "checklist", label: t("agentPanel.stream.checklistTab") },
            { value: "stream", label: t("agentPanel.stream.activityTab") },
            { value: "pinned", label: t("agentPanel.stream.pinnedTab") },
          ]}
        />

        {supportsDurableStream ? (
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t("agentPanel.stream.search")}
            clearAccessibilityLabel={t("globalStream.clearSearch")}
            testID="companion-stream-search"
          />
        ) : null}
        {query.supportsTags ? (
          <TagCloud
            counts={query.tagCounts}
            pinned={query.pinnedTags}
            active={tags}
            onToggle={tagFilter.toggle}
            onTogglePin={supportsWrites ? tagFilter.setPinned : undefined}
            error={tagFilter.error}
          />
        ) : null}

        <Button
          variant="ghost"
          onPress={refresh}
          disabled={query.isFetching || connection !== "online"}
        >
          {t("globalStream.refresh")}
        </Button>
        {notices.map((notice) => (
          <Text key={notice} accessibilityRole="alert" style={styles.description}>
            {notice}
          </Text>
        ))}
        {viewTab === "checklist" ? (
          <Text style={styles.description}>{t("agentPanel.stream.checklistDescription")}</Text>
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
        {viewTab !== "pinned" && (
          <View style={styles.segmentContainer}>
            {viewTab === "stream" ? (
              <SegmentedControl
                value={filter}
                onValueChange={setFilter}
                size="sm"
                options={[
                  { value: "all", label: t("agentPanel.stream.filterAll") },
                  { value: "question", label: t("agentPanel.stream.filterQuestions") },
                  { value: "q_and_a", label: t("agentPanel.stream.filterQAndA") },
                  { value: "feature_request", label: t("agentPanel.stream.filterFeatures") },
                  { value: "permission", label: t("agentPanel.stream.filterDecisions") },
                  { value: "outcome", label: t("agentPanel.stream.filterOutcomes") },
                ]}
              />
            ) : null}
            <Button
              variant={onlyOpen ? "secondary" : "outline"}
              style={styles.touchTarget}
              onPress={handleToggleOnlyOpen}
              testID="companion-stream-pending"
            >
              {t(onlyOpen ? "agentPanel.stream.showCompleted" : "agentPanel.stream.showUnresolved")}
            </Button>
          </View>
        )}

        {supportsWrites ? (
          <StreamNoteComposer
            key={viewTab}
            mode={viewTab}
            saving={saving}
            online={connection === "online"}
            supportsTags={query.supportsTags}
            knownTags={knownTags}
            onSubmit={handleSubmitNote}
          />
        ) : null}
      </View>
    ),
    [
      connection,
      refresh,
      query.isFetching,
      notices,
      viewTab,
      filter,
      onlyOpen,
      t,
      handleToggleOnlyOpen,
      handleSubmitNote,
      supportsWrites,
      saveError,
      saving,
      olderHost,
      hostName,
      hostVersion,
      supportsDurableStream,
      search,
      tags,
      knownTags,
      query.supportsTags,
      query.tagCounts,
      query.pinnedTags,
      tagFilter.toggle,
      tagFilter.setPinned,
      tagFilter.error,
    ],
  );

  const showActivity = useCallback(() => {
    setViewTab("stream");
    setFilter("all");
    setOnlyOpen(false);
  }, []);

  const empty = useMemo(
    () => (
      <View style={styles.empty} testID="companion-stream-empty">
        <Text style={styles.title}>
          {t(viewTab === "pinned" ? "agentPanel.stream.noPinned" : "agentPanel.stream.noItems")}
        </Text>
        {viewTab === "checklist" ? (
          <>
            <Text style={styles.description}>{t("agentPanel.stream.noExplicitAsks")}</Text>
            <Button variant="outline" onPress={showActivity}>
              {t("agentPanel.stream.showActivity")}
            </Button>
          </>
        ) : null}
        <Button variant="outline" style={styles.touchTarget} onPress={onReturnToChat}>
          {t("agentPanel.stream.backToChat")}
        </Button>
      </View>
    ),
    [viewTab, onReturnToChat, t, showActivity],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {query.hasNextPage ? (
          <Button onPress={loadMore} disabled={query.isFetching || connection !== "online"}>
            {t("globalStream.more")}
          </Button>
        ) : null}
        {query.isLoading ? <ActivityIndicator /> : null}
        <Text style={styles.description}>{t("agentPanel.stream.historyNote")}</Text>
      </View>
    ),
    [query.hasNextPage, query.isFetching, query.isLoading, loadMore, connection, t],
  );

  // Only a known host without the per-chat Stream at all gets the blocking notice.
  if (hostKnown && !isSupported) {
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
  touchTarget: { minHeight: 44 },
  empty: { gap: theme.spacing[3], paddingVertical: theme.spacing[6] },
  separator: { height: theme.spacing[3] },
  footer: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[6],
  },
  segmentContainer: { gap: theme.spacing[2], marginTop: theme.spacing[2] },
}));
