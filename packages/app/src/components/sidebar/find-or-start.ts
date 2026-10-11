import { useMemo } from "react";
import equal from "fast-deep-equal";
import { create } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { matchesSessionIdQuery, parseSessionIdQuery } from "@getpaseo/protocol/search/session-id";
import { useSessionStore } from "@/stores/session-store";

/**
 * The sidebar's one field: it finds chats as you type and starts a new one by default
 * (docs/sidebar-filter.md, "One field"). Enter starts a new chat with the text; Mod+Enter runs
 * Find with AI; Mod+Shift+Enter starts and opens. The only exception to "Enter starts a chat" is a
 * pasted session id that names exactly one chat: Enter opens it, and the row says so first.
 */
export interface SessionTarget {
  serverId: string;
  agentId: string;
  workspaceId: string;
  title: string;
}

export function useUniqueSessionForQuery(query: string): SessionTarget | null {
  const prefix = parseSessionIdQuery(query);
  const matches = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!prefix) return [];
      const found: SessionTarget[] = [];
      for (const [serverId, session] of Object.entries(state.sessions)) {
        for (const agent of session?.agents.values() ?? []) {
          if (agent.archivedAt || !agent.workspaceId) continue;
          if (!matchesSessionIdQuery(agent.id, prefix)) continue;
          found.push({
            serverId,
            agentId: agent.id,
            workspaceId: agent.workspaceId,
            title: agent.title?.trim() || agent.id.slice(0, 8),
          });
          if (found.length > 1) return found;
        }
      }
      return found;
    },
    equal,
  );
  return useMemo(() => (matches.length === 1 ? (matches[0] ?? null) : null), [matches]);
}

/**
 * The live results render outside the routing composer, which owns delivery. The composer
 * registers how to target a chat here, so a matched chat's "Send" control can hand it the chat
 * and the typed text without a second search field.
 */
interface RoutingBridgeState {
  sendHere: ((target: { serverId: string; agentId: string }) => void) | null;
  register: (sendHere: ((target: { serverId: string; agentId: string }) => void) | null) => void;
}

export const useRoutingBridge = create<RoutingBridgeState>((set) => ({
  sendHere: null,
  register: (sendHere) => set({ sendHere }),
}));
