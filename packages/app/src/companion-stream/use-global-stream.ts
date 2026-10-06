import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { StreamListOptions, StreamRow } from "@getpaseo/protocol/global-stream";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useFetchQueries } from "@/data/query";

export type GlobalStreamRow = StreamRow & { serverId: string; serverLabel: string };
interface HostPage {
  rows: StreamRow[];
  hasMore: boolean;
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
  const selected = hosts.filter((host) => !options.serverId || host.serverId === options.serverId);
  const availability = selected.map((host) => {
    if (!isHostRuntimeConnected(runtime.getSnapshot(host.serverId))) return "offline";
    // COMPAT(globalStream): fork beta.11; remove after 2027-04-06.
    if (!sessions[host.serverId]?.serverInfo?.features?.globalStream) return "upgrade";
    return "online";
  });
  const results = useFetchQueries<HostPage>(
    selected.map((host, index) => ({
      queryKey: [
        "global-stream",
        host.serverId,
        options.filter,
        options.search,
        options.includeArchived,
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
        for (let page = 0; page < depth; page++) {
          const result = await client.listGlobalStream({
            filter: options.filter,
            search: options.search,
            includeArchived: options.includeArchived,
            cursor,
            limit: 50,
          });
          rows.push(...result.rows);
          cursor = result.nextCursor ?? undefined;
          if (!cursor) break;
        }
        return { rows, hasMore: Boolean(cursor) };
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
          options.filter,
          options.search,
          options.includeArchived,
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
    options.filter,
    options.search,
    options.includeArchived,
  ]);
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
    notices,
    refetch,
    fetchNextPage,
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    isFetchingNextPage: depth > 1 && results.some((result) => result.isFetching),
    hasNextPage: results.some((result) => result.data?.hasMore),
  };
}
