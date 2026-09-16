# Agent tab control — findings and design

Status: **implemented on `feat/agent-tab-control`** (both the MCP tab tools and
the queue-instead-of-interrupt send policy; the design sections below describe
what shipped). This doc also carries the findings for the second, related
change: stopping mid-turn messages from killing running provider subagents.

Implementation notes that postdate the design:

- Both features landed on this one branch because the send fix depends on the
  queue-mirror branch's `AgentQueueService`; the branch merges
  `feat/queue-mirror-across-devices` rather than stacking a third branch.
- The busy policy lives in
  `packages/server/src/server/agent-queue/send-or-queue.ts` and is used by the
  WS send handler and MCP `send_agent_prompt`; `setupFinishNotification` queues
  inline. `send_agent_message_request` and `send_agent_prompt` carry the
  optional `interrupt` flag; responses report `queued`.
- The app's default `sendBehavior` flipped to `"queue"`; the interrupt-labeled
  send path passes `interrupt: true` explicitly.
- `open_tab`/`close_tab` are registered only when the daemon wires the
  `uiCommands` dependency (bootstrap always does). `close_tab` extends the
  `ui.command` push with `tab.close`, which the app maps to
  `closeTabByTarget` in the workspace layout store.
- `update_agent` (MCP) gained `workspaceId` (move between workspaces) and
  nullable label values (clear a label), backed by
  `AgentManager.updateAgentMetadata`.

## Why

An orchestrator agent can call the daemon's MCP tools (`create_agent`,
`create_workspace`, `send_agent_prompt`) but has no way to control what the
human actually sees: it cannot open a tab in its own workspace view, focus one,
close one, or surface an existing agent as a tab. Created child agents show up
linked under the caller but never as first-class tabs.

## Architecture map

### Tabs are client-side; the daemon knows almost nothing

- The tab model lives in the app: `packages/app/src/workspace-tabs/model.ts`
  (`WorkspaceTab`, `WorkspaceTabTarget` — agent / provider_subagent / terminal /
  browser / file / draft / working_diff / setup / commit_diff). Layout and tab
  operations (`openTabInLayoutFocused`, `closeTabInLayout`, `focusTabInLayout`)
  are pure functions in `packages/app/src/stores/workspace-layout-actions.ts`.
  Persistence is per device, keyed `serverId:workspaceId`.
- Which agents auto-open as tabs is a pure policy:
  `packages/app/src/workspace-tabs/agent-visibility.ts` auto-opens only
  workspace-root agents. `isWorkspaceRootAgent`
  (`packages/app/src/subagents/workspace-root-policy.ts`) returns false for any
  agent with `parentAgentId` in the same workspace. **This is why an MCP-created
  child agent never appears as a tab**: `create_agent` from an agent-scoped
  caller stamps the `paseo.parent-agent-id` label, the app maps it to
  `parentAgentId`, and the visibility policy treats it as a delegated subagent.
- The daemon learns a tab exists only through agent labels:
  `paseo.open-agent-tab.<clientId>` (`packages/protocol/src/agent-labels.ts`),
  written by `packages/app/src/subagents/use-open-agent-tab-labels.ts` whenever
  a client has an agent tab open. Upstream PR #5 (`fm/paseo-cli-tabs`) adds a
  `paseo.auto-open-agent-tab` placement hint that CLI-created agents carry and
  the client honors during reconciliation.

### What `feat/ui-tab-control` already shipped (commit 0def68bd9)

- Protocol: `ui.tab.open.request` / `.response`, an outbound `ui.command` push
  (`payload.command: "tab.open"`, workspaceId, `UiWorkspaceTabTarget`, focus),
  and a `uiCommands` capability flag. `UiWorkspaceTabTarget` mirrors the app's
  tab-target union.
- Server: `packages/server/src/server/ui-commands.ts` validates the workspace
  and builds the push; `session.ts` broadcasts it to every trusted client
  except the caller and reports the delivered count.
- App: `push-router` routes `ui.command` into a queue
  (`packages/app/src/ui-commands/queue.ts`); `UiCommandListener` drains it,
  navigates to the workspace, and the workspace screen reconciles the tab.
  `resolve.ts` converts the wire target to the app target.
- CLI: `paseo ui open-tab --workspace <id> --agent|--terminal|--file|--draft`.

Gaps relative to the goal: the RPC is reachable only from a WebSocket client
(app or CLI), **not from the MCP tools an agent holds**; only `tab.open`
exists (no close, no focus-existing beyond open's `focus` flag); nothing sets
a persistent placement hint, so a client that attaches later reconciles the
tab away.

### How the MCP layer knows the caller

`/mcp/agents` is served in `bootstrap.ts` (~line 1314). The caller's identity
arrives as a `?callerAgentId=` query param (the URL, including a per-daemon-run
token, is injected into each agent's MCP config). Tool handlers in
`packages/server/src/server/agent/tools/paseo-tools.ts` receive
`callerAgentId` via `PaseoToolHostDependencies` and already use it to default
cwd/workspace and to stamp `paseo.parent-agent-id` on created agents.

## Design: MCP tab control (objective 1)

Extend `feat/ui-tab-control`'s machinery; do not invent a second path.

New MCP tools in `paseo-tools.ts`, gated on the same `uiCommands` capability:

- **`open_tab`** — `{ target, workspaceId?, focus? }` where `target` is the
  same discriminated union as `UiWorkspaceTabTargetSchema` (open an agent, a
  terminal, a file, a draft composer, a diff…). `workspaceId` defaults to the
  caller agent's workspace. Reuses the pure `buildUiTabOpenCommand` and the
  same broadcast; returns `{ delivered }` (count of clients that received the
  push). For `agent` targets, also stamp the `paseo.auto-open-agent-tab`
  label (PR #5's hint) so clients that attach later reconcile the tab in —
  the push handles clients attached now, the label handles clients attached
  later.
- **`close_tab`** — `{ target, workspaceId? }`. Requires extending the
  `ui.command` push with `command: "tab.close"` and a matching app resolver
  that maps target → tabId and calls `closeTabInLayout`. For agent targets it
  also clears the auto-open/open-tab labels so reconciliation does not reopen
  it.

Not building: `focus_tab` (`open_tab` is reconcile-or-focus already — its
`focus` flag focuses an existing tab), `rename_tab` (tab titles derive from
their targets; renaming an agent via `update_agent` renames its tab), and
tab reordering.

"Move an agent into my session" decomposes into existing pieces plus one small
addition: `update_agent` gains an optional `workspaceId` so an agent can be
moved between workspaces, then `open_tab` surfaces it. Clearing a
`paseo.parent-agent-id` label (promote subagent to root) already works through
the WS `update_agent` (labels support null) but the MCP `update_agent` schema
only accepts string values — widen it to allow explicit clearing.

Protocol note: `ui.*` exists only on this fork (never shipped upstream), so
widening `ui.command` with `tab.close` is safe now. If the branch is ever sent
upstream, it goes as one unit.

## Findings: mid-turn messages kill running subagents (objective 2)

Symptom: send a message to a session whose turn is running Claude Task
subagents and the subagents die with "stopped by the user".

The chain, all on v0.4.0:

1. The app setting `sendBehavior` defaults to `"interrupt"`
   (`packages/app/src/hooks/use-settings/storage.ts:123`). With that default,
   submitting while the agent runs is a **force send** — the send button is
   even labeled "send and interrupt" (`composer/input/labels.ts:13`). The
   dictation auto-send path does the same (`composer/input/state.ts:83`).
   Only `sendBehavior: "queue"` routes to the queue
   (`composer/submit.ts:45`, `composer/input/state.ts:73,113`).
2. The server handler (`session.ts` `send_agent_message_request`) calls
   `sendPromptToAgent` (`agent/agent-prompt.ts:181`), which hardcodes
   `replaceRunning: true` (line 209).
3. `startAgentRun` → `replaceAgentRun` (`agent-manager.ts:2371`) →
   `cancelAgentRunBefore` → `cancelAgentRun` → `session.interrupt()`.
4. The Claude provider's `interrupt()` (`providers/claude/agent.ts:2262`)
   cancels the foreground turn and calls the SDK `query.interrupt()`, which
   aborts every in-flight tool call — including Task subagents. The
   "[Request interrupted by user…]" placeholder (`claude/agent.ts:363`) is the
   "stopped by the user" Jacob sees.

Two more surfaces share the interrupting default because they also go through
`sendPromptToAgent`:

- The MCP `send_agent_prompt` tool — one agent prompting a busy agent
  interrupts it.
- `setupFinishNotification` (`agent-prompt.ts:301`) — when a child agent
  finishes, the notification prompt **interrupts the caller's in-flight turn**,
  killing the caller's own subagents. An orchestrator running several children
  gets its turn killed by the first child that finishes.

The daemon-side queue from `feat/queue-mirror-across-devices`
(`agent-queue/service.ts`) drains the head on the running→idle edge with the
same `sendPromptToAgent`, so queued delivery machinery already exists.

### Design: queue by default, interrupt only on request

Zero-code mitigation available today: Settings → send behavior → "queue".
But the default, dictation, MCP prompts, and finish notifications all still
interrupt, so the daemon default changes:

1. Protocol: optional `interrupt?: boolean` on `send_agent_message_request`
   (optional field — backward compatible).
2. Server: when the target has an in-flight run and `interrupt` is not
   explicitly true, **enqueue via `AgentQueueService`** instead of
   `replaceRunning`. Respond `accepted: true` with an optional `queued: true`.
   Explicit `interrupt: true` keeps today's replace behavior.
3. App: pass `interrupt: true` only for the user's explicit
   interrupt gesture (setting `"interrupt"` + force send). Queue mode is
   unchanged.
4. `setupFinishNotification` and MCP `send_agent_prompt`: queue-when-busy,
   never interrupt.
5. Later, separately: true mid-turn injection for Claude by pushing the user
   message into the provider's persistent input stream
   (`claude/agent.ts:2982` `createAsyncMessageInput`) so the message joins the
   current turn the way typing into Claude Code's own TUI does. Deferred: it
   needs turn-accounting changes in the run state machine.

This lands as its own feature branch per FORK.md (it depends on the
queue-mirror branch's `AgentQueueService`, so it stacks on that PR for any
upstream submission).

## Branch map (fork model per FORK.md)

- `feat/ui-tab-control` — shipped `ui.tab.open` end to end (v0.4.0 base).
- `feat/agent-tab-control` — this branch: MCP `open_tab`/`close_tab`,
  `tab.close` command, auto-open label stamping, `update_agent.workspaceId`.
- `feat/queue-mirror-across-devices` — daemon-held queue (already merged into
  `jacob/daily`).
- queue-instead-of-interrupt fix — new branch off v0.4.0, stacked on the
  queue-mirror work.
