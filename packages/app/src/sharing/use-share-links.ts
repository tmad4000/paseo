import { useReplicaQuery } from "@/data/query";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

export function useShareLinks(serverId: string, agentId: string | undefined, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const queryKey = ["share-links", serverId, agentId];
  const query = useReplicaQuery({
    pushEvent: "share.link.update",
    queryKey,
    enabled: enabled && !!client,
    queryFn: () => client!.listShareLinks(agentId),
    refetchInterval: enabled ? 60000 : false,
  });
  useEffect(() => {
    if (!enabled || !client) return;
    const observation = client.observeEvents(["share.link.update"]);
    observation.subscribe({
      snapshot: () => {},
      update: () => {
        void queryClient.invalidateQueries({ queryKey: ["share-links", serverId] });
      },
    });
    return () => {
      void observation.release().catch(() => {});
    };
  }, [enabled, client, agentId, serverId, queryClient]);
  return { client, ...query };
}
