import { needsUserInput, type CompanionEntry } from "@getpaseo/protocol/companion-stream";
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
  /** The managed agent's model, falling back to what its runtime reports. Null when unknown. */
  model: string | null;
  /** Last change the host recorded: the agent's activity, or the provider descriptor's update. */
  lastActivityAt: Date | null;
  /** Questions the child waits on a person for (its own Needs you items). */
  openQuestions: number;
  /** What a card shows when expanded in place, without loading the child's timeline. */
  detail: SubthreadDetail;
  createdAt: Date;
}

export interface SubthreadActivity {
  kind: "blocker" | "report";
  text: string;
}

export interface SubthreadTaskProgress {
  done: number;
  total: number;
  /** The task being worked now, in its active form when the provider gives one. */
  current: string | null;
}

export interface SubthreadDetail {
  /** The latest blocker or report, markdown-free but keeping its line breaks. */
  report: SubthreadActivity | null;
  /** Title of the newest pending permission; approval is never given from the card. */
  pendingPermission: string | null;
  tasks: SubthreadTaskProgress | null;
  modeId: string | null;
  /** Last segment of the working directory: the worktree's name for a worktree agent. */
  location: string | null;
  /** A provider subagent's task description in full, and its type. */
  description: string | null;
  subagentType: string | null;
}

const EMPTY_DETAIL: SubthreadDetail = {
  report: null,
  pendingPermission: null,
  tasks: null,
  modeId: null,
  location: null,
  description: null,
  subagentType: null,
};

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

const REPORT_MAX_LENGTH = 2000;

/** Like `condenseActivityText`, but keeps paragraphs: the expanded card shows the report whole. */
export function plainReportText(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(?:---+|\*\*\*+)\s*$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>+)\s+/gm, "")
    .replace(/[`*]+/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain.length > REPORT_MAX_LENGTH
    ? `${plain.slice(0, REPORT_MAX_LENGTH - 1).trimEnd()}…`
    : plain;
}

function latestActivityEntry(
  entries: readonly CompanionEntry[] | undefined,
): { entry: CompanionEntry; kind: SubthreadActivity["kind"] } | null {
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
  if (blocker) return { entry: blocker, kind: "blocker" };
  return report ? { entry: report, kind: "report" } : null;
}

/**
 * The child's latest blocker or report from its Stream entries. Absent on hosts without the
 * companion Stream, where rows fall back to their subtitle.
 */
export function selectSubthreadActivity(
  entries: readonly CompanionEntry[] | undefined,
): SubthreadActivity | null {
  const latest = latestActivityEntry(entries);
  if (!latest) return null;
  const text = condenseActivityText(latest.entry.text);
  return text ? { kind: latest.kind, text } : null;
}

function selectReport(entries: readonly CompanionEntry[] | undefined): SubthreadActivity | null {
  const latest = latestActivityEntry(entries);
  if (!latest) return null;
  const text = plainReportText(latest.entry.text);
  return text ? { kind: latest.kind, text } : null;
}

/** Done over total, and the task in progress. Absent when the agent reports no tasks. */
export function summarizeTaskProgress(
  tasks:
    | readonly { text: string; completed: boolean; status?: string; activeForm?: string }[]
    | undefined,
): SubthreadTaskProgress | null {
  if (!tasks || tasks.length === 0) return null;
  let done = 0;
  let current: string | null = null;
  for (const task of tasks) {
    if (task.completed || task.status === "completed") done += 1;
    else if (current === null && task.status === "in_progress") {
      current = task.activeForm?.trim() || task.text.trim() || null;
    }
  }
  return { done, total: tasks.length, current };
}

function directoryName(cwd: string | undefined): string | null {
  const trimmed = cwd?.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return null;
  return trimmed.split(/[\\/]/).at(-1) || null;
}

function managedDetail(agent: Agent | undefined): SubthreadDetail {
  if (!agent) return EMPTY_DETAIL;
  const permission = agent.pendingPermissions.at(-1);
  return {
    report: selectReport(agent.companionEntries),
    pendingPermission: permission
      ? permission.title?.trim() || permission.name?.trim() || null
      : null,
    tasks: summarizeTaskProgress(agent.tasks),
    modeId: agent.currentModeId ?? null,
    location: directoryName(agent.cwd),
    description: null,
    subagentType: null,
  };
}

/** The card fields that differ by kind: a managed agent's record, or a provider descriptor. */
function cardFields(
  row: SubagentRow,
  agent: Agent | undefined,
  names: { description: string | null; title: string | null },
): Pick<SubthreadRow, "model" | "lastActivityAt" | "detail"> {
  if (row.kind === "provider") {
    return {
      model: null,
      lastActivityAt: row.updatedAt,
      detail: { ...EMPTY_DETAIL, description: names.description, subagentType: names.title },
    };
  }
  return {
    model: agent?.model?.trim() || agent?.runtimeInfo?.model?.trim() || null,
    lastActivityAt: agent?.lastActivityAt ?? null,
    detail: managedDetail(agent),
  };
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
      labels: agent?.labels,
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
      openQuestions: (agent?.companionEntries ?? []).filter(needsUserInput).length,
      ...cardFields(row, agent, { description, title }),
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

// --- Registry groups ---

/** The two kinds the registry keeps apart: spawned agents (`paseo`) and provider subagents. */
export type SubthreadGroupKind = SubthreadRow["kind"];

export interface SubthreadGroup {
  kind: SubthreadGroupKind;
  rows: SubthreadRow[];
  summary: SubthreadSummary;
}

const GROUP_ORDER: readonly SubthreadGroupKind[] = ["paseo", "provider"];

/** Spawned agents, then provider subagents, each in creation order. Empty groups are dropped. */
export function groupSubthreadRows(rows: readonly SubthreadRow[]): SubthreadGroup[] {
  return GROUP_ORDER.flatMap((kind) => {
    const members = rows.filter((row) => row.kind === kind);
    return members.length > 0
      ? [{ kind, rows: members, summary: summarizeSubthreads(members) }]
      : [];
  });
}

/**
 * The registry's header line counts spawned agents only: a finished Explore task should not read
 * as something that needs you. A chat with provider subagents alone still says how many it has.
 */
export function summarizeRegistryHeader(rows: readonly SubthreadRow[]): SubthreadSummary {
  const spawned = rows.filter((row) => row.kind === "paseo");
  if (spawned.length > 0) return summarizeSubthreads(spawned);
  return { total: rows.length, needsInput: 0, failed: 0, unread: 0, running: 0 };
}

/**
 * Whether a group starts folded. An explicit choice wins. Otherwise spawned agents are open, and
 * provider subagents fold away once the chat has spawned agents of its own to watch.
 */
export function resolveGroupCollapsed(input: {
  kind: SubthreadGroupKind;
  stored: boolean | undefined;
  hasSpawned: boolean;
}): boolean {
  if (input.stored !== undefined) return input.stored;
  return input.kind === "provider" && input.hasSpawned;
}

/** One stop in the registry's roving focus: a group heading or a card. */
export type RegistryFocusItem =
  | { type: "group"; key: string; kind: SubthreadGroupKind }
  | { type: "card"; key: string; kind: SubthreadGroupKind; row: SubthreadRow };

export function registryGroupFocusKey(kind: SubthreadGroupKind): string {
  return `group:${kind}`;
}

export function registryCardFocusKey(row: Pick<SubthreadRow, "kind" | "id">): string {
  return `card:${row.kind}:${row.id}`;
}

/** Headings and the cards of expanded groups, top to bottom: what Up and Down walk through. */
export function buildRegistryFocusItems(
  groups: readonly SubthreadGroup[],
  isCollapsed: (kind: SubthreadGroupKind) => boolean,
): RegistryFocusItem[] {
  const items: RegistryFocusItem[] = [];
  for (const group of groups) {
    items.push({ type: "group", key: registryGroupFocusKey(group.kind), kind: group.kind });
    if (isCollapsed(group.kind)) continue;
    for (const row of group.rows) {
      items.push({ type: "card", key: registryCardFocusKey(row), kind: group.kind, row });
    }
  }
  return items;
}

/** Up and Down stop at the ends rather than wrapping, so the list reads as one column. */
export function moveRegistryFocus(
  items: readonly RegistryFocusItem[],
  currentKey: string | null,
  delta: 1 | -1,
): string | null {
  if (items.length === 0) return null;
  const index = currentKey ? items.findIndex((item) => item.key === currentKey) : -1;
  if (index === -1) return items[delta === 1 ? 0 : items.length - 1]!.key;
  const next = Math.min(items.length - 1, Math.max(0, index + delta));
  return items[next]!.key;
}

/**
 * Where focus goes when the item holding it disappears (its group folded, or its agent was
 * archived or detached): the item now at its position, else the one before, else nothing.
 */
export function resolveRegistryFocusAfterRemoval(
  previous: readonly RegistryFocusItem[],
  next: readonly RegistryFocusItem[],
  removedKey: string,
): string | null {
  if (next.some((item) => item.key === removedKey)) return removedKey;
  const index = previous.findIndex((item) => item.key === removedKey);
  if (index === -1) return next[0]?.key ?? null;
  for (let cursor = index + 1; cursor < previous.length; cursor += 1) {
    const candidate = previous[cursor]!.key;
    if (next.some((item) => item.key === candidate)) return candidate;
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = previous[cursor]!.key;
    if (next.some((item) => item.key === candidate)) return candidate;
  }
  return null;
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
