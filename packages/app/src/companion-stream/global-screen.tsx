import { useCallback, useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { StreamFilter } from "@getpaseo/protocol/global-stream";
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
import { EntryCard } from "./feed";
import { useGlobalStream, type GlobalStreamRow } from "./use-global-stream";

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const rowKey = (row: GlobalStreamRow) => JSON.stringify([row.serverId, row.id]);

export function GlobalStreamScreen() {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const hosts = useHosts();
  const [host, setHost] = useState(ALL_HOSTS_OPTION_ID);
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const query = useGlobalStream({
    serverId: host === ALL_HOSTS_OPTION_ID ? null : host,
    filter,
    search: useDebouncedValue(search, 250),
    includeArchived,
    enabled: focused,
  });
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
  const toggleArchived = useCallback(() => setIncludeArchived((value) => !value), []);
  const renderItem = useCallback(
    ({ item }: { item: GlobalStreamRow }) => <GlobalStreamCard row={item} onSaved={refresh} />,
    [refresh],
  );
  const tabs = useMemo(
    () => [
      { value: "all" as const, label: t("globalStream.all") },
      { value: "pending" as const, label: t("globalStream.pending") },
      { value: "pinned" as const, label: t("globalStream.pinned") },
    ],
    [t],
  );
  const header = useMemo(
    () => (
      <View style={styles.header}>
        <Text style={styles.description}>{t("globalStream.description")}</Text>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t("globalStream.search")}
          clearAccessibilityLabel={t("globalStream.clearSearch")}
          testID="global-stream-search"
        />
        <SegmentedControl value={filter} onValueChange={setFilter} options={tabs} />
        <View style={styles.controls}>
          <HostFilter
            hosts={hosts}
            selectedHost={host}
            onSelectHost={setHost}
            triggerTestID="global-stream-host"
          />
          <Button variant={includeArchived ? "secondary" : "ghost"} onPress={toggleArchived}>
            {t("globalStream.archived")}
          </Button>
          <Button variant="ghost" onPress={refresh} disabled={isFetching}>
            {t("globalStream.refresh")}
          </Button>
        </View>
        {notices.map((notice) => (
          <Text key={notice} style={styles.notice} accessibilityRole="alert">
            {notice}
          </Text>
        ))}
      </View>
    ),
    [
      t,
      search,
      filter,
      tabs,
      hosts,
      host,
      includeArchived,
      toggleArchived,
      refresh,
      isFetching,
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
    <View style={styles.root} testID="global-stream">
      <MenuHeader title={t("globalStream.title")} />
      <FlatList
        data={query.rows}
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

function GlobalStreamCard({ row, onSaved }: { row: GlobalStreamRow; onSaved: () => void }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(row.serverId);
  const connection = useHostRuntimeConnectionStatus(row.serverId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openChat = useCallback(() => {
    navigateToAgent({ serverId: row.serverId, agentId: row.agentId, workspaceId: row.workspaceId });
  }, [row.serverId, row.agentId, row.workspaceId]);
  const update = useCallback(
    async (entryId: string, status?: "open" | "reviewed" | "done") => {
      if (!client || connection !== "online" || busy) return;
      setBusy(true);
      setError(null);
      try {
        await client.updateStreamEntry({
          agentId: row.agentId,
          entryId,
          action: status ? "update_status" : "remove_pin",
          status,
        });
        onSaved();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t("globalStream.saveFailed"));
      } finally {
        setBusy(false);
      }
    },
    [client, connection, busy, row.agentId, onSaved, t],
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
  return (
    <View style={styles.row} testID={`global-stream-row-${row.agentId}`}>
      <Button variant="ghost" onPress={openChat} style={styles.source}>
        {row.agentTitle} · {row.serverLabel}
        {row.archived ? ` · ${t("globalStream.archived")}` : ""}
      </Button>
      <Text style={styles.path} numberOfLines={1}>
        {row.cwd}
      </Text>
      {row.item.kind === "entry" ? (
        <EntryCard
          entry={row.item.entry}
          onReturnToChat={openChat}
          onReplyInChat={openChat}
          onUpdateStatus={updateStatus}
          onRemovePin={removePin}
          disabled={busy || connection !== "online"}
        />
      ) : (
        <View style={styles.artifact}>
          <Text style={styles.description}>{t("globalStream.artifact")}</Text>
          <Text selectable style={styles.artifactPath}>
            {row.item.artifact.path}
          </Text>
          <Button variant="outline" onPress={openChat}>
            {t("globalStream.openChat")}
          </Button>
        </View>
      )}
      {busy ? <Text style={styles.description}>{t("globalStream.saving")}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {error}
        </Text>
      ) : null}
    </View>
  );
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
