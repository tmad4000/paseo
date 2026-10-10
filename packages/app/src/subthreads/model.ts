import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { Agent } from "@/stores/session-store";
import type { SubagentRow } from "@/subagents/select";
import { resolveRowLabel, subagentPresentationStatus } from "@/subagents/track-presentation";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

/**
 * One subthread in an orchestrator's drawer. Built from the same rows the subagents track
 * shows, plus the managed agent's own permission and attention state, which the track
 * deliberately leaves out of its pill.
 */
export interface SubthreadRow {
  kind: SubagentRow["kind"];
  id: string;
  provider: SubagentRow["provider"];
  label: string | null;
  subtitle: string | null;
  bucket: SidebarStateBucket;
  /** A permission or question is waiting on the user. */
  needsInput: boolean;
  /** Finished since the user last read it. */
  unread: boolean;
  /** Only managed Paseo subagents take prompts; provider-owned children are read-only. */
  canReply: boolean;
  /** The child's own workspace, when it is a managed agent that reports one. */
  workspaceId: string | null;
  /**
   * One condensed line of what the child last did, so the parent's user can monitor without
   * opening it: a pending approval (blocker) wins over the latest turn report.
   */
  activity: SubthreadActivity | null;
  createdAt: Date;
}

export interface SubthreadActivity {
  kind: "blocker" | "report";
  text: string;
}

const ACTIVITY_MAX_LENGTH = 160;

/** Markdown-free, single-line, bounded: the row truncates further to fit. */
export function condenseActivityText(text: string): string {
  const condensed = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(?:---+|\*\*\*+)\s*$/gm, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>+)\s+/gm, "")
    .replace(/[`*]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return condensed.length > ACTIVITY_MAX_LENGTH
    ? `${condensed.slice(0, ACTIVITY_MAX_LENGTH - 1).trimEnd()}…`
    : condensed;
}

/**
 * The child's latest blocker or report from its Stream entries. Absent on hosts without the
 * companion Stream, where rows fall back to their subtitle.
 */
export function selectSubthreadActivity(
  entries: readonly CompanionEntry[] | undefined,
): SubthreadActivity | null {
  if (!entries || entries.length === 0) return null;
  let blocker: CompanionEntry | null = null;
  let report: CompanionEntry | null = null;
  for (const entry of entries) {
    if (entry.kind === "permission" && entry.status === "pending") {
      if (!blocker || entry.timestamp >= blocker.timestamp) blocker = entry;
    } else if (entry.kind === "outcome") {
      if (!report || entry.timestamp >= report.timestamp) report = entry;
    }
  }
  const chosen = blocker ?? report;
  if (!chosen) return null;
  const text = condenseActivityText(chosen.text);
  return text ? { kind: chosen === blocker ? "blocker" : "report", text } : null;
}

export type SubthreadAgentLookup = (agentId: string) => Agent | undefined;

export function buildSubthreadRows(
  rows: readonly SubagentRow[],
  lookupAgent: SubthreadAgentLookup,
): SubthreadRow[] {
  return rows.map((row) => {
    const status = subagentPresentationStatus(row);
    const agent = row.kind === "paseo" ? lookupAgent(row.id) : undefined;
    const bucket = deriveSidebarStateBucket({
      status,
      pendingPermissionCount: agent?.pendingPermissions.length ?? 0,
      requiresAttention: row.kind === "paseo" ? Boolean(row.requiresAttention) : false,
      attentionReason: agent?.attentionReason ?? null,
    });
    const description = resolveRowLabel(row.description);
    const title = resolveRowLabel(row.title);
    const providerSubtitle = row.kind === "provider" ? resolveRowLabel(row.subtitle) : null;
    return {
      kind: row.kind,
      id: row.id,
      provider: row.provider,
      label: description ?? title,
      subtitle: providerSubtitle ?? (description ? title : null),
      bucket,
      needsInput: bucket === "needs_input",
      // Failed and needs-input are their own states; unread is the finished-but-unseen one, so a
      // row is never counted twice in the summary.
      unread: bucket === "attention",
      canReply: row.kind === "paseo",
      workspaceId: agent?.workspaceId ?? null,
      activity: selectSubthreadActivity(agent?.companionEntries),
      createdAt: row.createdAt,
    };
  });
}

export interface SubthreadSummary {
  total: number;
  needsInput: number;
  failed: number;
  unread: number;
  running: number;
}

export function summarizeSubthreads(rows: readonly SubthreadRow[]): SubthreadSummary {
  const summary: SubthreadSummary = {
    total: rows.length,
    needsInput: 0,
    failed: 0,
    unread: 0,
    running: 0,
  };
  for (const row of rows) {
    if (row.needsInput) summary.needsInput += 1;
    if (row.bucket === "failed") summary.failed += 1;
    if (row.unread) summary.unread += 1;
    if (row.bucket === "running") summary.running += 1;
  }
  return summary;
}

// --- Drawer state ---

/** Which half of the pane owns typing, dictation, and pane-scoped shortcuts. */
export type SubthreadsFocus = "parent" | "drawer";

/** What the session's side panel shows: its subagents, or a checklist beside the chat. */
export type SidePanelMode = "subagents" | "checklist";

export interface SubthreadSelection {
  kind: SubthreadRow["kind"];
  id: string;
}

export interface SubthreadsDrawerState {
  open: boolean;
  mode: SidePanelMode;
  focus: SubthreadsFocus;
  selection: SubthreadSelection | null;
}

export const CLOSED_SUBTHREADS_DRAWER: SubthreadsDrawerState = {
  open: false,
  mode: "subagents",
  focus: "parent",
  selection: null,
};

export type SubthreadsDrawerEvent =
  | { type: "open"; mode?: SidePanelMode; selection?: SubthreadSelection | null }
  | { type: "close" }
  /** The keyboard shortcut: open, then move into the drawer, then close. */
  | { type: "toggle" }
  | { type: "mode"; mode: SidePanelMode }
  | { type: "select"; selection: SubthreadSelection }
  | { type: "back" }
  /** The selected child left the parent: drop it without taking input from either side. */
  | { type: "clear-selection" }
  | { type: "focus"; focus: SubthreadsFocus }
  /**
   * The session's persisted side-panel label changed (an agent, the CLI, or another device).
   * `null` closes. Focus stays where the user is: a programmatic open never steals typing.
   */
  | { type: "apply-label"; panel: SidePanelMode | null };

export function reduceSubthreadsDrawer(
  state: SubthreadsDrawerState,
  event: SubthreadsDrawerEvent,
): SubthreadsDrawerState {
  switch (event.type) {
    case "open":
      return {
        open: true,
        mode: event.mode ?? state.mode,
        focus: "drawer",
        selection: event.selection === undefined ? state.selection : event.selection,
      };
    case "close":
      // The selection survives so reopening returns to the thread the user was reading.
      return { ...state, open: false, focus: "parent" };
    case "toggle":
      return toggleSidePanel(state);
    case "mode":
      return { ...state, open: true, mode: event.mode, focus: "drawer" };
    case "select":
      return { open: true, mode: "subagents", focus: "drawer", selection: event.selection };
    case "back":
      return { ...state, focus: "drawer", selection: null };
    case "clear-selection":
      return state.selection === null ? state : { ...state, selection: null };
    case "focus":
      return !state.open || state.focus === event.focus ? state : { ...state, focus: event.focus };
    case "apply-label":
      return applySidePanelLabel(state, event.panel);
  }
}

function toggleSidePanel(state: SubthreadsDrawerState): SubthreadsDrawerState {
  if (!state.open) return { ...state, open: true, focus: "drawer" };
  if (state.focus === "parent") return { ...state, focus: "drawer" };
  return { ...state, open: false, focus: "parent" };
}

function applySidePanelLabel(
  state: SubthreadsDrawerState,
  panel: SidePanelMode | null,
): SubthreadsDrawerState {
  if (panel === null) {
    return state.open ? { ...state, open: false, focus: "parent" } : state;
  }
  if (state.open && state.mode === panel) return state;
  return { ...state, open: true, mode: panel, focus: state.open ? state.focus : "parent" };
}

/**
 * Which composer may act on input. At most one is ever active, so a keystroke, a dictation
 * toggle, or an interrupt cannot fan out to the orchestrator and a subthread at once.
 */
export function resolveComposerActivity(input: {
  paneInteractive: boolean;
  state: SubthreadsDrawerState;
  /** On compact layouts the drawer covers the parent, so the parent can never own input. */
  drawerCoversParent: boolean;
}): { parentActive: boolean; subthreadActive: boolean } {
  const { paneInteractive, state, drawerCoversParent } = input;
  if (!paneInteractive) return { parentActive: false, subthreadActive: false };
  if (!state.open) return { parentActive: true, subthreadActive: false };
  const drawerOwns = drawerCoversParent || state.focus === "drawer";
  return {
    parentActive: !drawerOwns,
    subthreadActive: drawerOwns && state.mode === "subagents" && state.selection !== null,
  };
}

/**
 * The row the drawer shows. A selection whose child was archived or detached resolves to
 * nothing, so the drawer falls back to the list instead of replying into a stale target.
 */
export function resolveSelectedSubthread(
  rows: readonly SubthreadRow[],
  selection: SubthreadSelection | null,
): SubthreadRow | null {
  if (!selection) return null;
  return rows.find((row) => row.kind === selection.kind && row.id === selection.id) ?? null;
}

export function stepSubthreadSelection(
  rows: readonly SubthreadRow[],
  current: SubthreadSelection | null,
  delta: 1 | -1,
): SubthreadSelection | null {
  if (rows.length === 0) return null;
  const index = current
    ? rows.findIndex((row) => row.kind === current.kind && row.id === current.id)
    : -1;
  const firstIndex = delta === 1 ? 0 : rows.length - 1;
  const nextIndex = index === -1 ? firstIndex : index + delta;
  const next = rows[(nextIndex + rows.length) % rows.length];
  return next ? { kind: next.kind, id: next.id } : null;
}
