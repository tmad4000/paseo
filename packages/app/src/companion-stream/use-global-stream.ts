import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type {
  StreamListOptions,
  StreamRow,
  StreamTagCount,
} from "@getpaseo/protocol/global-stream";
import { normalizeStreamTags, streamEntryTags } from "@getpaseo/protocol/stream-tags";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useFetchQueries } from "@/data/query";
import { deduplicateTasks } from "./task-identity";
import { mergeTagCounts } from "./tag-model";

export type GlobalStreamRow = StreamRow & { serverId: string; serverLabel: string };
interface HostPage {
  rows: StreamRow[];
  hasMore: boolean;
  tagCounts?: StreamTagCount[];
  pinnedTags?: string[];
}
const NO_TAGS: string[] = [];

function streamQueryKey(serverId: string, options: StreamListOptions, tags: string, depth: number) {
  return [
    "global-stream",
    serverId,
    options.agentId,
    options.asksOnly,
    options.view,
    options.relatedAgentId,
    options.relatedServerId,
    options.userQuestionsOnly,
    options.filter,
    options.search,
    options.includeArchived,
    tags,
    depth,
  ];
}

/** Hosts without server-side tag filtering still get the AND filter applied to returned rows. */
function rowHasTags(row: StreamRow, tags: readonly string[]): boolean {
  if (row.item.kind !== "entry") return false;
  const entryTags = streamEntryTags(row.item.entry);
  return tags.every((tag) => entryTags.includes(tag));
}

export function useGlobalStream(
  options: StreamListOptions & { serverId: string | null; enabled: boolean },
) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const queryClient = useQueryClient();
  const runtime = getHostRuntimeStore();
  useSyncExternalStore(
    (notify) => runtime.subscribeAll(notify),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  const sessions = useSessionStore((state) => state.sessions);
  const [depth, setDepth] = useState(1);
  const tags = useMemo(() => normalizeStreamTags(options.tags ?? []), [options.tags]);
  const tagKey = tags.join(" ");
  const selected = hosts.filter((host) => !options.serverId || host.serverId === options.serverId);
  const availability = selected.map((host) => {
    if (!isHostRuntimeConnected(runtime.getSnapshot(host.serverId))) return "offline";
    // COMPAT(globalStream): fork beta.11; remove after 2027-04-06.
    if (
      !(options.agentId
        ? sessions[host.serverId]?.serverInfo?.features?.durableStream
        : sessions[host.serverId]?.serverInfo?.features?.globalStream)
    )
      return "upgrade";
    // COMPAT(streamWorkflow): fork feature, remove after 2027-04-27.
    const needsWorkflow =
      options.relatedAgentId ||
      (options.view && options.view !== "activity" && options.view !== "saved");
    if (needsWorkflow && !sessions[host.serverId]?.serverInfo?.features?.streamWorkflow)
      return "workflow-upgrade";
    return "online";
  });
  // COMPAT(streamTags): fork feature; remove gate after 2027-04-24.
  const tagHosts = selected.map(
    (host) => sessions[host.serverId]?.serverInfo?.features?.streamTags === true,
  );
  const workflowHosts = selected.map(
    (host) => sessions[host.serverId]?.serverInfo?.features?.streamWorkflow === true,
  );
  const results = useFetchQueries<HostPage>(
    selected.map((host, index) => ({
      queryKey: streamQueryKey(host.serverId, options, tagKey, depth),
      dataShape: "value",
      staleTimeMs: 10_000,
      enabled: options.enabled && availability[index] === "online",
      refetchInterval: options.enabled && availability[index] === "online" ? 15_000 : false,
      queryFn: async () => {
        const client = runtime.getClient(host.serverId);
        if (!client) throw new Error("Host disconnected");
        const rows: StreamRow[] = [];
        let cursor: string | undefined;
        let tagCounts: StreamTagCount[] | undefined;
        let pinnedTags: string[] | undefined;
        for (let page = 0; page < depth; page++) {
          const result = await client.listGlobalStream({
            agentId: options.agentId,
            asksOnly: options.asksOnly,
            ...(workflowHosts[index]
              ? {
                  view: options.view,
                  relatedAgentId: options.relatedAgentId,
                  relatedServerId: options.relatedServerId,
                }
              : {}),
            userQuestionsOnly: options.userQuestionsOnly,
            filter: !workflowHosts[index] && options.view === "saved" ? "pinned" : options.filter,
            search: options.search,
            includeArchived: options.includeArchived,
            ...(tagHosts[index] && tags.length ? { tags } : {}),
            cursor,
            limit: 50,
          });
          rows.push(...result.rows);
          tagCounts ??= result.tagCounts;
          pinnedTags ??= result.pinnedTags;
          cursor = result.nextCursor ?? undefined;
          if (!cursor) break;
        }
        return {
          rows: tags.length ? rows.filter((row) => rowHasTags(row, tags)) : rows,
          hasMore: Boolean(cursor),
          tagCounts,
          pinnedTags,
        };
      },
    })),
  );
  const rows = useMemo(() => {
    const byId = new Map<string, GlobalStreamRow>();
    for (const [index, result] of results.entries()) {
      const host = selected[index];
      let data = result.data;
      for (let prior = depth - 1; !data && prior > 0; prior--) {
        data = queryClient.getQueryData<HostPage>(
          streamQueryKey(host.serverId, options, tagKey, prior),
        );
      }
      for (const row of data?.rows ?? [])
        byId.set(
          JSON.stringify([host.serverId, row.id]),
          Object.assign({}, row, { serverId: host.serverId, serverLabel: host.label }),
        );
    }
    const merged = [...byId.values()];
    const projected =
      options.view && options.view !== "activity" ? deduplicateTasks(merged) : merged;
    const rank = (row: GlobalStreamRow) =>
      options.view === "tasks" && row.item.kind === "entry" && row.item.entry.ask?.state === "done"
        ? 1
        : 0;
    return projected.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.timestamp.localeCompare(a.timestamp) ||
        a.serverId.localeCompare(b.serverId) ||
        a.id.localeCompare(b.id),
    );
  }, [results, selected, depth, queryClient, options, tagKey]);
  const tagCounts = useMemo(
    () => mergeTagCounts(results.map((result) => result.data?.tagCounts ?? [])),
    [results],
  );
  const pinnedTags = useMemo(() => {
    const merged: string[] = [];
    for (const result of results)
      for (const tag of result.data?.pinnedTags ?? NO_TAGS)
        if (!merged.includes(tag)) merged.push(tag);
    return merged;
  }, [results]);
  const supportsTags = tagHosts.some(
    (supported, index) => supported && availability[index] === "online",
  );
  /** Pin on every selected online host that supports tags; a single chat lives on one host. */
  const setTagPinned = useCallback(
    async (tag: string, pinned: boolean) => {
      const writes = selected.flatMap((host, index) => {
        const client = runtime.getClient(host.serverId);
        if (options.relatedServerId && options.relatedServerId !== host.serverId) return [];
        if (!client || !tagHosts[index] || availability[index] !== "online") return [];
        const agentId = options.relatedAgentId ?? options.agentId;
        return [client.setStreamTagPinned({ agentId, tag, pinned })];
      });
      if (!writes.length) throw new Error("No connected host supports Stream tags");
      await Promise.all(writes);
      await Promise.all(results.map((result) => result.refetch()));
    },
    [
      selected,
      runtime,
      tagHosts,
      availability,
      options.agentId,
      options.relatedAgentId,
      options.relatedServerId,
      results,
    ],
  );
  const notices = selected.flatMap((host, index) => {
    if (availability[index] === "offline")
      return [t("globalStream.hostOfflineNotice", { host: host.label })];
    if (availability[index] === "workflow-upgrade")
      return [t("globalStream.hostWorkflowUpgradeNotice", { host: host.label })];
    if (availability[index] === "upgrade")
      return [t("globalStream.hostUpgradeNotice", { host: host.label })];
    const error = results[index].error;
    return error
      ? [t("globalStream.hostErrorNotice", { host: host.label, error: error.message })]
      : [];
  });
  const refetch = useCallback(
    () =>
      Promise.all(
        results.map((result, index) =>
          availability[index] === "online" ? result.refetch() : Promise.resolve(),
        ),
      ),
    [results, availability],
  );
  const fetchNextPage = useCallback(() => setDepth((value) => value + 1), []);
  return {
    rows,
    notices,
    refetch,
    tagCounts,
    pinnedTags,
    supportsTags,
    setTagPinned,
    fetchNextPage,
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    isFetchingNextPage: depth > 1 && results.some((result) => result.isFetching),
    hasNextPage: results.some((result) => result.data?.hasMore),
  };
}
