import { create } from "zustand";
import {
  resolveSplitDropPosition,
  type SplitDropZonePosition,
} from "@/components/split-drop-position";

/**
 * Dragging a sidebar row onto the current workspace opens that session there: on a pane edge it
 * splits the pane, on a pane's tab strip (or its center) it opens as a tab. This module holds the
 * pure decisions and the small shared state; the web drag source drives it (desktop/web only).
 */

export type SidebarDragPayload =
  | { kind: "agent"; serverId: string; agentId: string; workspaceId?: string | null }
  | { kind: "workspace"; serverId: string; workspaceId: string };

export type SidebarDropZone = "tabs" | SplitDropZonePosition;

export interface SidebarDropTarget {
  workspaceKey: string;
  paneId: string;
  zone: SidebarDropZone;
}

export interface DropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function contains(rect: DropRect, x: number, y: number): boolean {
  return (
    x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
  );
}

/** Where on a pane the pointer is: its tab strip, or one of the in-workspace tab drag's edge zones. */
export function resolveSidebarDropZone(input: {
  paneRect: DropRect;
  tabsRect: DropRect | null;
  x: number;
  y: number;
}): SidebarDropZone | null {
  const { paneRect, tabsRect, x, y } = input;
  if (tabsRect && contains(tabsRect, x, y)) return "tabs";
  if (!contains(paneRect, x, y) || paneRect.width <= 0 || paneRect.height <= 0) return null;
  return resolveSplitDropPosition({
    width: paneRect.width,
    height: paneRect.height,
    x: x - paneRect.left,
    y: y - paneRect.top,
  });
}

export interface DroppableAgent {
  id: string;
  workspaceId?: string | null;
  archivedAt?: Date | string | null;
  lastActivityAt?: Date | string | null;
}

function activityTime(agent: DroppableAgent): number {
  const value = agent.lastActivityAt;
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

/** A workspace row drops the session most recently active in that workspace. */
export function resolveLastActiveWorkspaceAgent<T extends DroppableAgent>(
  agents: Iterable<T>,
  workspaceId: string,
): T | null {
  let best: T | null = null;
  for (const agent of agents) {
    if (agent.workspaceId !== workspaceId || agent.archivedAt) continue;
    if (!best || activityTime(agent) > activityTime(best)) best = agent;
  }
  return best;
}

export type SidebarDropPlan =
  /** The session already has a tab in this layout: move it rather than duplicate it. */
  | { kind: "move-tab"; tabId: string; paneId: string }
  | { kind: "split-with-tab"; tabId: string; paneId: string; position: SplitPosition }
  /** New tab; `pin` keeps a foreign session through tab reconciliation (see foreign-sessions). */
  | { kind: "open-tab"; paneId: string; pin: boolean }
  | { kind: "split-and-open"; paneId: string; position: SplitPosition; pin: boolean };

export type SplitPosition = Exclude<SplitDropZonePosition, "center">;

export function planSidebarSessionDrop(input: {
  zone: SidebarDropZone;
  paneId: string;
  existingTabId: string | null;
  homeWorkspaceId: string | null;
  layoutWorkspaceId: string;
}): SidebarDropPlan {
  const { zone, paneId, existingTabId } = input;
  const pin = Boolean(input.homeWorkspaceId) && input.homeWorkspaceId !== input.layoutWorkspaceId;
  const intoPane = zone === "tabs" || zone === "center";
  if (existingTabId) {
    return intoPane
      ? { kind: "move-tab", tabId: existingTabId, paneId }
      : { kind: "split-with-tab", tabId: existingTabId, paneId, position: zone };
  }
  return intoPane
    ? { kind: "open-tab", paneId, pin }
    : { kind: "split-and-open", paneId, position: zone, pin };
}

export type SidebarDropOutcome = "dropped" | "other-host" | "no-session" | "ignored";

/** The workspace currently on screen, registered while its route is focused. */
export interface SidebarDropHost {
  serverId: string;
  workspaceKey: string;
  drop: (payload: SidebarDragPayload, target: SidebarDropTarget) => SidebarDropOutcome;
}

let activeHost: SidebarDropHost | null = null;

export function registerSidebarDropHost(host: SidebarDropHost): () => void {
  activeHost = host;
  return () => {
    if (activeHost === host) activeHost = null;
  };
}

export function getSidebarDropHost(): SidebarDropHost | null {
  return activeHost;
}

interface SidebarSessionDragState {
  /** True once a sidebar row has been dragged out over the workspace. */
  active: boolean;
  target: SidebarDropTarget | null;
}

export const useSidebarSessionDragStore = create<SidebarSessionDragState>(() => ({
  active: false,
  target: null,
}));

function sameTarget(a: SidebarDropTarget | null, b: SidebarDropTarget | null): boolean {
  return a?.workspaceKey === b?.workspaceKey && a?.paneId === b?.paneId && a?.zone === b?.zone;
}

export function setSidebarDragState(next: SidebarSessionDragState): void {
  const current = useSidebarSessionDragStore.getState();
  if (current.active === next.active && sameTarget(current.target, next.target)) return;
  useSidebarSessionDragStore.setState(next);
}

/** The zone a sidebar drag is hovering on this pane, for its drop preview. */
export function useSidebarDropZoneForPane(workspaceKey: string, paneId: string) {
  return useSidebarSessionDragStore((state) =>
    state.target?.workspaceKey === workspaceKey && state.target.paneId === paneId
      ? state.target.zone
      : null,
  );
}
