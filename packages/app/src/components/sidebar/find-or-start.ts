import { create } from "zustand";
import { matchesSessionIdQuery, parseSessionIdQuery } from "@getpaseo/protocol/search/session-id";
import type { SidebarTabMatches } from "./sidebar-filter-matches";

/**
 * The sidebar's one field: it finds chats as you type and starts a new one by default
 * (docs/sidebar-filter.md, "One field"). Enter starts a new chat with the text; Mod+Enter runs
 * Find with AI; Mod+Shift+Enter starts and opens. The only exception to "Enter starts a chat" is a
 * pasted session id that names exactly one chat, which Enter opens, and the row says so first.
 */
export interface SessionTarget {
  serverId: string;
  agentId: string;
  workspaceId: string;
  title: string;
}

/**
 * The chat a pasted session id names, taken from the tab rows the filter is actually showing:
 * the same hosts, project and label filters, and tab rules (no child agents, no untitled or
 * archived chats). So "Open" never names a chat the list hides, and a prefix that also matches a
 * hidden chat cannot make a visible one look ambiguous. Title matches do not count: only the id.
 */
export function pickUniqueSessionIdMatch(
  tabMatches: SidebarTabMatches,
  visibleWorkspaceKeys: ReadonlySet<string>,
  normalizedQuery: string,
): SessionTarget | null {
  const prefix = parseSessionIdQuery(normalizedQuery);
  if (!prefix) return null;
  let found: SessionTarget | null = null;
  for (const [workspaceKey, matches] of tabMatches) {
    if (!visibleWorkspaceKeys.has(workspaceKey)) continue;
    for (const match of matches) {
      if (!matchesSessionIdQuery(match.agentId, prefix)) continue;
      if (found) return null;
      found = {
        serverId: match.serverId,
        agentId: match.agentId,
        workspaceId: match.workspaceId,
        title: match.title,
      };
    }
  }
  return found;
}

export function sessionRouteKey(target: { serverId: string; agentId: string }): string {
  return JSON.stringify([target.serverId, target.agentId]);
}

/**
 * The field and the live results render outside the routing composer, which owns delivery. The
 * composer publishes what they need here: how to make a chat the destination of the typed text,
 * which chats can be destinations (routable keys, see `sessionRouteKey`), whether routing is
 * locked while its durable draft loads or a delivery is pending, and Find with AI for Mod+Enter.
 */
export interface RoutingBridgeEntry {
  sendHere: (target: { serverId: string; agentId: string }) => void;
  findWithAi: () => void;
  routableKeys: ReadonlySet<string>;
  locked: boolean;
}

interface RoutingBridgeState {
  entry: RoutingBridgeEntry | null;
  register: (entry: RoutingBridgeEntry) => void;
  /** Clears only the given entry, so a composer unmounting cannot clear a newer one. */
  unregister: (entry: RoutingBridgeEntry) => void;
}

export const useRoutingBridge = create<RoutingBridgeState>((set, get) => ({
  entry: null,
  register: (entry) => set({ entry }),
  unregister: (entry) => {
    if (get().entry === entry) set({ entry: null });
  },
}));
