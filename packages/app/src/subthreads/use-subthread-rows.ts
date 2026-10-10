import { useMemo } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore } from "@/stores/session-store";
import { useSubagentsForParent } from "@/subagents/select";
import { buildSubthreadRows, summarizeSubthreads, type SubthreadRow } from "./model";

/** The orchestrator's subthreads, in the subagents track's order (creation time). */
export function useSubthreadRows(input: { serverId: string; parentAgentId: string }): {
  rows: SubthreadRow[];
  summary: ReturnType<typeof summarizeSubthreads>;
} {
  const subagentRows = useSubagentsForParent(input);
  const rows = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const session = state.sessions[input.serverId];
      return buildSubthreadRows(
        subagentRows,
        (agentId) => session?.agents.get(agentId) ?? session?.agentDetails.get(agentId),
      );
    },
    equal,
  );
  const summary = useMemo(() => summarizeSubthreads(rows), [rows]);
  return { rows, summary };
}
