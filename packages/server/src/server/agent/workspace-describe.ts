import type { Logger } from "pino";
import type {
  AgentListItemPayload,
  WorkspaceDescribedAgent,
  WorkspaceDescribedAsk,
  WorkspaceDescribedPin,
  WorkspaceDescription,
} from "@getpaseo/protocol/messages";
import type { StreamListOptions, StreamRow } from "@getpaseo/protocol/global-stream";
import {
  buildWorkspaceFocusSummary,
  truncateFocusText,
  WORKSPACE_FOCUS_LIMITS,
} from "@getpaseo/protocol/workspace-focus";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";
import type { AgentProvider, AgentTimelineItem } from "./agent-sdk-types.js";
import { buildStoredAgentPayload, toAgentListItemPayload } from "./agent-projections.js";
import { serializeSnapshotWithMetadata } from "./mcp-shared.js";
import { isStoredAgentProviderAvailable } from "../persistence-hooks.js";
import type { PersistedConversationSource } from "../session-text-history.js";
import type { SessionTextSearchMessage } from "../session-text-search.js";
import {
  resolveWorkspaceDisplayName,
  type PersistedWorkspaceRecord,
} from "../workspace-registry.js";

/**
 * describe_workspace: what every chat in one workspace is on, for agents that cannot see the tabs.
 *
 * Everything is read, never resumed. Loaded agents answer from the daemon's timeline; dormant
 * Claude and Codex agents from their provider transcript (session-text-history.ts). Other
 * providers keep history behind their runtimes and show only their Stream items until loaded.
 */

export interface AgentListCollectionDeps {
  agentManager: Pick<AgentManager, "listAgents">;
  agentStorage: AgentStorage;
  listRegisteredProviderIds: () => Iterable<AgentProvider>;
  logger: Logger;
}

/** Live agents plus stored ones the daemon has not loaded, as list rows (shared with list_agents). */
export async function collectAgentListItems(
  deps: AgentListCollectionDeps,
  options: { includeArchived: boolean },
): Promise<{ items: AgentListItemPayload[]; records: StoredAgentRecord[] }> {
  const liveSnapshots = deps.agentManager.listAgents();
  const liveAgents = await Promise.all(
    liveSnapshots.map((snapshot) =>
      serializeSnapshotWithMetadata(deps.agentStorage, snapshot, deps.logger),
    ),
  );
  const liveIds = new Set(liveSnapshots.map((snapshot) => snapshot.id));
  const records = await deps.agentStorage.list();
  const registeredProviderIds = new Set(deps.listRegisteredProviderIds());
  const storedAgents = records
    .filter((record) => !record.internal && !liveIds.has(record.id))
    .filter((record) => options.includeArchived || !record.archivedAt)
    .filter(
      (record) =>
        options.includeArchived || isStoredAgentProviderAvailable(record, registeredProviderIds),
    )
    .map((record) => buildStoredAgentPayload(record, registeredProviderIds));
  return {
    items: [...liveAgents, ...storedAgents].map(toAgentListItemPayload),
    records,
  };
}

export interface ConversationReader {
  read(source: PersistedConversationSource): Promise<SessionTextSearchMessage[]>;
  readFirstUserMessage(source: PersistedConversationSource): Promise<string | null>;
}

export interface DescribeWorkspaceDeps extends AgentListCollectionDeps {
  agentManager: Pick<
    AgentManager,
    | "listAgents"
    | "getAgent"
    | "getTimeline"
    | "readRecentConversationMessages"
    | "listGlobalStream"
  >;
  workspaceRegistry?: { get(workspaceId: string): Promise<PersistedWorkspaceRecord | null> };
  conversationReader: ConversationReader;
  now?: () => Date;
}

export interface DescribeWorkspaceInput {
  workspaceId: string;
  excludeAgentId?: string;
}

const RECENT_MESSAGE_LIMIT = 200;
const SYSTEM_ENVELOPE_OPEN = "<paseo-system>";
const STREAM_ASK_PAGE = 100;
const STREAM_PIN_PAGE = 20;

export async function describeWorkspace(
  deps: DescribeWorkspaceDeps,
  input: DescribeWorkspaceInput,
): Promise<WorkspaceDescription> {
  const workspace = (await deps.workspaceRegistry?.get(input.workspaceId)) ?? null;
  const { items, records } = await collectAgentListItems(deps, { includeArchived: false });
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const members = items
    .filter((item) => item.workspaceId === input.workspaceId && !item.archivedAt)
    .filter((item) => item.id !== input.excludeAgentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  if (!workspace && members.length === 0) {
    throw new Error(`Workspace not found: ${input.workspaceId}`);
  }

  const agents = await Promise.all(
    members.map((item) => describeAgent(deps, item, recordsById.get(item.id) ?? null)),
  );
  return {
    workspaceId: input.workspaceId,
    title: workspace ? resolveWorkspaceDisplayName(workspace) : null,
    cwd: workspace?.cwd ?? null,
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    agents,
  };
}

async function describeAgent(
  deps: DescribeWorkspaceDeps,
  item: AgentListItemPayload,
  record: StoredAgentRecord | null,
): Promise<WorkspaceDescribedAgent> {
  const [conversation, stream] = await Promise.all([
    readConversationMarkers(deps, item, record),
    readStreamItems(deps, item.id),
  ]);
  const focus = {
    firstUserMessage: truncateFocusText(
      conversation.firstUserMessage,
      WORKSPACE_FOCUS_LIMITS.firstUserChars,
    ),
    lastUserMessage: truncateFocusText(
      conversation.lastUserMessage,
      WORKSPACE_FOCUS_LIMITS.lastUserChars,
    ),
    lastAssistantMessage: truncateFocusText(
      conversation.lastAssistantMessage,
      WORKSPACE_FOCUS_LIMITS.lastAssistantChars,
    ),
  };
  return {
    id: item.id,
    title: item.title,
    provider: item.provider,
    model: item.model,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastUserMessageAt: item.lastUserMessageAt,
    labels: item.labels,
    parentAgentId: item.parentAgentId ?? null,
    focus: {
      ...focus,
      summary: buildWorkspaceFocusSummary({
        title: item.title,
        ...focus,
        openAsks: stream?.openAsks ?? null,
        pins: stream?.pins ?? null,
      }),
    },
    openAsks: stream?.openAsks ?? null,
    pins: stream?.pins ?? null,
  };
}

interface ConversationMarkers {
  firstUserMessage: string | null;
  lastUserMessage: string | null;
  lastAssistantMessage: string | null;
}

export async function readConversationMarkers(
  deps: Pick<DescribeWorkspaceDeps, "agentManager" | "conversationReader" | "logger">,
  item: Pick<AgentListItemPayload, "id" | "provider" | "cwd" | "updatedAt">,
  record: StoredAgentRecord | null,
): Promise<ConversationMarkers> {
  const source: PersistedConversationSource | null = record
    ? {
        agentId: record.id,
        provider: record.provider,
        cwd: record.cwd,
        persistence: record.persistence,
        activityStamp: `${record.lastActivityAt ?? ""}|${record.updatedAt}`,
      }
    : null;

  let recent: Array<{ text: string; role: "user" | "assistant" }> = [];
  try {
    recent = await deps.agentManager.readRecentConversationMessages(item.id, RECENT_MESSAGE_LIMIT);
  } catch (error) {
    deps.logger.debug({ err: error, agentId: item.id }, "describe_workspace: live timeline read");
  }
  if (recent.length === 0 && source) {
    recent = await deps.conversationReader.read(source);
  }

  let firstUserMessage = source ? await deps.conversationReader.readFirstUserMessage(source) : null;
  firstUserMessage ??= firstLiveUserMessage(deps, item.id);
  firstUserMessage ??= recent.find((message) => message.role === "user")?.text ?? null;

  return {
    firstUserMessage,
    // Injected turns (a child finished, a schedule fired, a mention) are not what the person said.
    lastUserMessage:
      recent.findLast((message) => message.role === "user" && !isSystemInjectedTurn(message.text))
        ?.text ?? null,
    lastAssistantMessage: recent.findLast((message) => message.role === "assistant")?.text ?? null,
  };
}

/** Paseo wraps injected prompts in <paseo-system>; transcripts may reflow the envelope's whitespace. */
export function isSystemInjectedTurn(text: string): boolean {
  return text.trimStart().startsWith(SYSTEM_ENVELOPE_OPEN);
}

function firstLiveUserMessage(
  deps: Pick<DescribeWorkspaceDeps, "agentManager">,
  agentId: string,
): string | null {
  if (!deps.agentManager.getAgent(agentId)) return null;
  let timeline: AgentTimelineItem[];
  try {
    timeline = deps.agentManager.getTimeline(agentId);
  } catch {
    return null;
  }
  for (const entry of timeline) {
    if (entry.type === "user_message" && entry.text.trim()) return entry.text;
  }
  return null;
}

async function readStreamItems(
  deps: Pick<DescribeWorkspaceDeps, "agentManager" | "logger">,
  agentId: string,
): Promise<{ openAsks: WorkspaceDescribedAsk[]; pins: WorkspaceDescribedPin[] } | null> {
  const list = (options: StreamListOptions) =>
    deps.agentManager.listGlobalStream({ agentId, includeArchived: true, ...options });
  try {
    const [tasks, saved] = await Promise.all([
      list({ view: "tasks", filter: "all", limit: STREAM_ASK_PAGE }),
      list({ view: "saved", filter: "all", limit: STREAM_PIN_PAGE }),
    ]);
    return { openAsks: toOpenAsks(tasks.rows), pins: toPins(saved.rows) };
  } catch (error) {
    deps.logger.debug({ err: error, agentId }, "describe_workspace: Stream unavailable");
    return null;
  }
}

export function toOpenAsks(rows: readonly StreamRow[]): WorkspaceDescribedAsk[] {
  const asks: WorkspaceDescribedAsk[] = [];
  for (const row of rows) {
    if (row.item.kind !== "entry") continue;
    const { entry } = row.item;
    if (!entry.ask || entry.ask.canonicalTask || entry.ask.state === "done") continue;
    asks.push({
      askId: entry.id.startsWith("ask:") ? entry.id.slice(4) : entry.id,
      text: entry.text,
      state: entry.ask.state,
    });
  }
  return asks;
}

export function toPins(rows: readonly StreamRow[]): WorkspaceDescribedPin[] {
  const pins: WorkspaceDescribedPin[] = [];
  for (const row of rows) {
    if (row.item.kind !== "entry" || row.item.entry.kind !== "pin") continue;
    pins.push({ entryId: row.item.entry.id, text: row.item.entry.text });
  }
  return pins;
}

/** The caller's workspace: the live agent first, then its stored record. */
export async function readAgentWorkspaceId(
  deps: { agentManager: Pick<AgentManager, "getAgent">; agentStorage: AgentStorage },
  agentId: string,
): Promise<string | null> {
  const live: ManagedAgent | null = deps.agentManager.getAgent(agentId);
  if (live?.workspaceId) return live.workspaceId;
  return (await deps.agentStorage.get(agentId))?.workspaceId ?? null;
}
