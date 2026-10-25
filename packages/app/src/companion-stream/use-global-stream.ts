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
import { mergeTagCounts } from "./tag-model";

export type GlobalStreamRow = StreamRow & { serverId: string; serverLabel: string };
interface HostPage {
  rows: StreamRow[];
  hasMore: boolean;
  counts?: {
    total: number;
    open: number;
    done: number;
    user: number;
    agent: number;
    unknown: number;
    matching: number;
  };
  coverage?: "loaded_history" | "not_loaded";
  tagCounts?: StreamTagCount[];
  pinnedTags?: string[];
}
const NO_TAGS: string[] = [];

/** Hosts without server-side tag filtering still get the AND filter applied to returned rows. */
function rowHasTags(row: StreamRow, tags: readonly string[]): boolean {
  if (row.item.kind !== "entry") return false;
  const entryTags = streamEntryTags(row.item.entry);
  return tags.every((tag) => entryTags.includes(tag));
}

export function useGlobalStream(
  options: StreamListOptions & { serverId: string | null; enabled: boolean },
) {
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
    return "online";
  });
  // COMPAT(streamTags): fork feature; remove gate after 2027-04-24.
  const tagHosts = selected.map(
    (host) => sessions[host.serverId]?.serverInfo?.features?.streamTags === true,
  );
  const results = useFetchQueries<HostPage>(
    selected.map((host, index) => ({
      queryKey: [
        "global-stream",
        host.serverId,
        options.agentId,
        options.asksOnly,
        options.includeMessageInventory,
        options.sourceRole,
        options.state,
        options.filter,
        options.search,
        options.includeArchived,
        tagKey,
        depth,
      ],
      dataShape: "value",
      staleTimeMs: 10_000,
      enabled: options.enabled && availability[index] === "online",
      refetchInterval: options.enabled && availability[index] === "online" ? 15_000 : false,
      queryFn: async () => {
        const client = runtime.getClient(host.serverId);
        if (!client) throw new Error("Host disconnected");
        const rows: StreamRow[] = [];
        let cursor: string | undefined;
        let counts: HostPage["counts"];
        let coverage: HostPage["coverage"];
        let tagCounts: StreamTagCount[] | undefined;
        let pinnedTags: string[] | undefined;
        for (let page = 0; page < depth; page++) {
          const result = await client.listGlobalStream({
            agentId: options.agentId,
            asksOnly: options.asksOnly,
            includeMessageInventory: options.includeMessageInventory,
            sourceRole: options.sourceRole,
            state: options.state,
            filter: options.filter,
            search: options.search,
            includeArchived: options.includeArchived,
            ...(tagHosts[index] && tags.length ? { tags } : {}),
            cursor,
            limit: 50,
          });
          rows.push(...result.rows);
          counts = result.counts;
          coverage = result.coverage;
          tagCounts ??= result.tagCounts;
          pinnedTags ??= result.pinnedTags;
          cursor = result.nextCursor ?? undefined;
          if (!cursor) break;
        }
        return {
          rows: tags.length ? rows.filter((row) => rowHasTags(row, tags)) : rows,
          counts,
          coverage,
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
        data = queryClient.getQueryData<HostPage>([
          "global-stream",
          host.serverId,
          options.agentId,
          options.asksOnly,
          options.includeMessageInventory,
          options.sourceRole,
          options.state,
          options.filter,
          options.search,
          options.includeArchived,
          tagKey,
          prior,
        ]);
      }
      for (const row of data?.rows ?? [])
        byId.set(
          JSON.stringify([host.serverId, row.id]),
          Object.assign({}, row, { serverId: host.serverId, serverLabel: host.label }),
        );
    }
    return [...byId.values()].sort(
      (a, b) =>
        b.timestamp.localeCompare(a.timestamp) ||
        a.serverId.localeCompare(b.serverId) ||
        a.id.localeCompare(b.id),
    );
  }, [
    results,
    selected,
    depth,
    queryClient,
    options.agentId,
    options.asksOnly,
    options.includeMessageInventory,
    options.sourceRole,
    options.state,
    options.filter,
    options.search,
    options.includeArchived,
    tagKey,
  ]);
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
        if (!client || !tagHosts[index] || availability[index] !== "online") return [];
        return [client.setStreamTagPinned({ agentId: options.agentId, tag, pinned })];
      });
      if (!writes.length) throw new Error("No connected host supports Stream tags");
      await Promise.all(writes);
      await Promise.all(results.map((result) => result.refetch()));
    },
    [selected, runtime, tagHosts, availability, options.agentId, results],
  );
  const notices = selected.flatMap((host, index) => {
    if (availability[index] === "offline")
      return [`${host.label}: offline — cached items may be out of date`];
    if (availability[index] === "upgrade")
      return [`${host.label}: update this host to use global Stream`];
    const error = results[index].error;
    return error ? [`${host.label}: ${error.message}`] : [];
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
    counts: results[0]?.data?.counts,
    coverage: results[0]?.data?.coverage,
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
