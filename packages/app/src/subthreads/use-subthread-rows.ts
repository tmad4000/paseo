import { useMemo } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import { useSessionStore } from "@/stores/session-store";
import { selectSubagentsForParent, useSubagentsForParent } from "@/subagents/select";
import {
  buildSubthreadRows,
  groupSubthreadRows,
  summarizeRegistryHeader,
  type SubthreadGroup,
  type SubthreadRow,
  type SubthreadSummary,
} from "./model";

/**
 * The orchestrator's subthreads: spawned agents, then provider subagents, each in creation order.
 * `summary` is the registry header's (spawned agents only); each group carries its own.
 */
export function useSubthreadRows(input: { serverId: string; parentAgentId: string }): {
  rows: SubthreadRow[];
  groups: SubthreadGroup[];
  summary: SubthreadSummary;
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
  const groups = useMemo(() => groupSubthreadRows(rows), [rows]);
  const summary = useMemo(() => summarizeRegistryHeader(rows), [rows]);
  return { rows, groups, summary };
}

const NO_ROWS: SubthreadRow[] = [];

/**
 * Every unarchived agent this chat spawned, in the registry's order, for surfaces that list
 * spawned agents only (the Questions and asks pane, the chat's Stream view). Provider subagents
 * are not fetched here.
 */
export function useSpawnedAgentRows(
  serverId: string,
  agentId: string,
  enabled = true,
): SubthreadRow[] {
  const pendingArchiveIds = usePendingArchiveAgentIds(serverId);
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!enabled) return NO_ROWS;
      const spawned = selectSubagentsForParent(
        state,
        { serverId, parentAgentId: agentId },
        pendingArchiveIds,
      );
      if (spawned.length === 0) return NO_ROWS;
      const session = state.sessions[serverId];
      return buildSubthreadRows(
        spawned,
        (id) => session?.agents.get(id) ?? session?.agentDetails.get(id),
      );
    },
    equal,
  );
}
