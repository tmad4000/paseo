import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

interface StreamTagScope {
  serverId: string;
  agentId: string;
}

const StreamTagScopeContext = createContext<StreamTagScope | null>(null);

/** Lets pin controls deep in a chat offer the host's existing tags without threading props. */
export function StreamTagScopeProvider({
  serverId,
  agentId,
  children,
}: StreamTagScope & { children: ReactNode }) {
  const value = useMemo(() => ({ serverId, agentId }), [serverId, agentId]);
  return <StreamTagScopeContext.Provider value={value}>{children}</StreamTagScopeContext.Provider>;
}

const NO_TAGS: string[] = [];

/** Host-wide tags by count, loaded only while `active`. Empty when the host lacks tag support. */
export function useStreamTagSuggestions(active: boolean): {
  supported: boolean;
  tags: string[];
} {
  const scope = useContext(StreamTagScopeContext);
  const serverId = scope?.serverId ?? "";
  const client = useHostRuntimeClient(serverId);
  // COMPAT(streamTags): fork feature; remove gate after 2027-04-24.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.streamTags === true,
  );
  const [tags, setTags] = useState<string[]>(NO_TAGS);
  useEffect(() => {
    if (!active || !supported || !client) return;
    let cancelled = false;
    client
      .listGlobalStream({ includeArchived: true, limit: 1 })
      .then((page) => {
        if (!cancelled) setTags((page.tagCounts ?? []).map((item) => item.tag));
        return;
      })
      // Suggestions are a convenience; typing a new tag still works.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, supported, client]);
  return { supported: Boolean(scope) && supported, tags };
}
