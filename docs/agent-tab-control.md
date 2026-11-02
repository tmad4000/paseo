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
- The app's default `sendBehavior` initially flipped to `"queue"`; the
  interrupt-labeled send path passes `interrupt: true` explicitly. The current
  composer default is described in [README.md](../README.md).
- `open_tab`/`close_tab` are registered only when the daemon wires the
  `uiCommands` dependency (bootstrap always does). `close_tab` extends the
  `ui.command` push with `tab.close`, which the app maps to
  `closeTabByTarget` in the workspace layout store.
- `update_agent` (MCP) gained `workspaceId` (move between workspaces) and
  nullable label values (clear a label), backed by
  `AgentManager.updateAgentMetadata`.

## Side placement, page targets and delivery (fork, 2026-10-10)

- **Delivery fix.** Since owned subscriptions (v0.8.0) a modern socket only accepts session
  messages that carry an ownership proof. `ui.command` is a pass-through broadcast with no
  proof, so every modern client dropped `open_tab`, `close_tab` and `paseo ui open-tab` while the
  daemon still reported them delivered. `SessionDelivery.permits` now accepts `ui.command`, and
  the broadcast is limited to connections of the requester's principal (the owner for MCP and
  CLI callers) so a hub's other principals never receive another user's tab instructions.
  Installed builds before this change have the bug: verify an `open_tab` visually, not by its
  `delivered` count.
- **`placement: "side"`** on `ui.tab.open.request`, the `ui.command` push, MCP `open_tab` and
  `paseo ui open-tab --side`. The client shows the target in the workspace's side pane (the
  same pane "open in side pane" uses) and selects it there, without navigating, moving the
  focused pane, or touching the caret, on every attached client. Compact layouts have no side
  pane; the tab opens in the background. Omitted or `"main"` keeps the old open-or-focus
  behaviour. Older clients ignore the field and treat it as main.
- **Page targets.** A browser target may carry `url` instead of (or with) `browserId`
  (`paseo ui open-tab --url`). The daemon derives a stable browser id from the URL
  (`protocol/src/ui-browser-target.ts`), so repeating an open reuses one tab and `close_tab` with
  the same URL closes it. Each client creates that browser once and keeps the user's own
  navigation afterwards. Only absolute http(s) URLs are accepted. Browser panes render in the
  desktop app only; web and native show the tab with a desktop-only notice, which is why the
  per-session side panel ([agent lifecycle](agent-lifecycle.md#the-session-side-panel-subagents-or-a-checklist))
  embeds checklists itself on every platform.

```sh
paseo ui open-tab --workspace <id> --url https://m4-mini.tailb2a35c.ts.net:8047/m4-checklist.html --side
```

Guards: an agent's `open_tab` with a page URL follows the same policy as the browser tools
(rejected when browser tools are off for that agent; the session side panel is the
alternative). A caller-supplied `browserId` on a page target must be a real browser id. Side
placement is also sent with `focus: false`, so clients that predate `placement` open it in the
background instead of navigating. The host advertises all of this as `uiTabPlacement`; the CLI
refuses `--side` and `--url` against a host without it.

**Drop a session beside the caller (2026-10-10).** With `placement: "side"`, an agent target may
live in any workspace on the host: the tab opens in the caller's workspace (the default for side
placement) as a foreign session that keeps its own home, and the daemon does not stamp the
auto-open label on it. `close_tab` with that workspace closes it there and leaves the session's
own tab labels alone. Main placement keeps its rule that an agent tab lives in the agent's
workspace.

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
  a client has an agent tab open. `paseo run` stamps the
  `paseo.auto-open-agent-tab` placement hint (`buildRunAgentLabels` in
  `packages/cli/src/commands/agent/run.ts`) so CLI-created agents become tabs in
  every client during reconciliation.

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

## Review status: "ready to review" instead of "done"

An agent (usually a delegated subagent) can flag its work for review rather
than just going idle, so an orchestrator or human distinguishes "the turn
ended" from "the work is complete and wants a look."

- Label-based, mirroring the auto-open pattern — no new lifecycle state, no
  protocol-enum change. `paseo.review-status` holds one of `ready`,
  `in_review`, `changes_requested`, `approved`; `paseo.review-note` holds an
  optional reviewer note (`packages/protocol/src/agent-labels.ts`,
  `getReviewStatus`/`getReviewNote`).
- MCP tool `set_review_status { status, agentId?, note? }` — `agentId` defaults
  to the caller, so a subagent marks its own work; `status: "clear"` removes
  the marker (and the note). Writes through the same `update_agent` path
  (nullable labels).
- Surfacing: the label already flows through `list_agents[].labels`, and
  `get_agent_status` gains a convenience `reviewStatus` field. An orchestrator
  polls or lists to find `ready` agents, reviews, then sets `approved` /
  `changes_requested`.
- Deliberately not built: a distinct push notification or attention reason
  (`finished`/`error`/`permission` is protocol-wide and rendered in
  notifications). The child's existing finish notification still fires when it
  goes idle; the review label enriches it. A dedicated "review ready"
  notification to the parent is a possible follow-up.

## Branch map (fork model per FORK.md)

- `feat/ui-tab-control` — shipped `ui.tab.open` end to end (v0.4.0 base).
- `feat/agent-tab-control` — MCP `open_tab`/`close_tab`, `tab.close` command,
  auto-open label stamping, `update_agent.workspaceId` + nullable labels.
- `feat/agent-review-status` — stacked on `feat/agent-tab-control` (needs its
  nullable-label support): the `set_review_status` tool + review labels.
- `feat/queue-mirror-across-devices` — daemon-held queue (already merged into
  `jacob/daily`).
- queue-instead-of-interrupt fix — new branch off v0.4.0, stacked on the
  queue-mirror work.

## Tab context menu, Restart agent and queue recovery (fork, 2026-11-01)

Right-click an agent tab (desktop) or open its tab menu (mobile) for per-agent controls. They are
built by `buildAgentTabControlMenuEntries` (`packages/app/src/screens/workspace/agent-tab-control-menu.ts`)
and appended by `useAgentTabControlMenuEntries`, the same hook pattern as Mark as unread, so no
callbacks are threaded through the split/tab tree. Every item calls an existing daemon RPC.

| Menu item                 | Daemon RPC                       | CLI                                | Agent MCP (`/mcp/agents`)    |
| ------------------------- | -------------------------------- | ---------------------------------- | ---------------------------- |
| Restart agent             | `agent.restart.request`          | `paseo agent restart <id>`         | `restart_agent`              |
| Interrupt (while running) | `cancel_agent_request`           | `paseo agent stop <id>`            | `cancel_agent`               |
| Mode: … (one per mode)    | `set_agent_mode_request`         | `paseo agent mode <id> <mode>`     | `set_agent_mode`             |
| Queued messages (N)       | snapshot (`agent.queue.update`)  | `paseo queue ls <id>`              | `list_queue`                 |
| Send now: …               | `agent.queue.send_now.request`   | `paseo queue send-now <id> <item>` | `send_queued_now`            |
| Deliver queue now         | `agent.queue.drain.request`      | `paseo queue drain <id>`           | `drain_queue`                |
| Clear queue               | `agent.queue.clear.request`      | `paseo queue clear <id>`           | `clear_queue`                |
| (remove one item)         | `agent.queue.remove.request`     | `paseo queue rm <id> <item>`       | `remove_queued_message`      |
| Copy attach command       | none (`paseo agent attach <id>`) | `paseo agent attach <id>`          | n/a                          |
| Open in new window        | desktop IPC `openNew({ agent })` | n/a                                | `open_tab` (existing window) |
| Archive agent             | `archive_agent_request`          | `paseo agent archive <id>`         | `archive_agent`              |
| Rename (existing)         | `update_agent_request`           | `paseo agent update <id> --name`   | `update_agent`               |
| Reload agent (existing)   | `refresh_agent_request`          | `paseo agent reload <id>`          | none (see gaps)              |

Capability flags: `agentRestart` and `queueDrain` (both `COMPAT`, fork). The menu hides Restart and
Deliver/Clear on hosts without them; Send now still needs `queueSendNow`. Open in new window builds
its route in the Electron main process from `{ serverId, agentId }`; the renderer never passes a URL.

### Restart vs Reload

**Reload** wipes the in-memory timeline and re-streams provider history (use it when the session
was changed outside Paseo, or to pick up skills/MCPs). **Restart** (`restartAgentCommand`,
`packages/server/src/server/agent/restart-agent.ts`) restarts the provider process and resumes the
same session _keeping the timeline_, then recovers and drains the queue. Keeping the timeline is
what lets it tell whether a stuck message already arrived.

### The stuck queue, and what Restart does about it

Two independent things strand a daemon queue on an idle agent:

1. Drains fire only on a running → idle edge (or enqueue / hold release / permission resolution),
   and nothing drains at daemon startup. An agent that is already idle never produces the edge.
2. A head item whose delivery receipt is `pending` — the daemon died between writing the receipt
   and confirming submission — is never retried automatically, by design (the provider may have
   received it). `drainWithReceipt` returns early on it forever, and every item behind it waits.

Agent 073a1f54 (2026-10-28 → 2026-11-01) hit case 2: head `164864a9…` pending since 05:44, 37 items
behind it. Restart fixes both: `AgentQueueService.recoverStalledHead` checks the timeline for a
user message whose `clientMessageId`/`messageId` equals the item id. Found → the receipt becomes
`completed` and the item is recorded as drained (no duplicate). Not found → the receipt is deleted
and the item is resent. Losing a message is worse than a possible duplicate, and Restart is the
user's explicit statement that the old dispatch is dead. Matching is by id only, never by text:
two identical "continue" messages must not cancel each other. A send still in flight on this
daemon is never settled (`MessageReceipts.settleStalePending` refuses). Then `drainNow` sends the
head; the rest follow one per turn, in order, on the normal idle edges.

`paseo queue ls` flags a pending head ("The first message is stuck … Run: paseo agent restart").
`drain_queue` / `paseo queue drain` alone fix case 1 but not case 2.

### Parity gaps (app actions without a CLI or MCP twin), as of 2026-11-01

- **Reload agent** has no MCP tool (`restart_agent` covers the recovery use; add `reload_agent` if
  agents need the re-stream).
- **Mark as read / unread** (`workspace.mark_unread.request`, agent attention): no CLI, no MCP.
- **Queue edit and reorder** (`agent.queue.edit`, `agent.queue.reorder`): no CLI, no MCP.
  Enqueue is covered by `send_agent_prompt` / `paseo agent send`, which queue when the agent is busy.
- **Model change** from the composer: MCP `update_agent.settings` covers it; the CLI's
  `agent update` has `--thinking` but no `--model`.
- **Rewind** (`agent.rewind.request`) and **fork context** (`agent.fork_context.request`): no CLI, no MCP.
- **Copy resume command** (provider-native resume line): app only; `paseo agent inspect` shows
  the session id.
- **Delete agent**: CLI `agent delete`; MCP has `kill_agent` (close) and `archive_agent`, no delete.
- **Open in new window**: desktop-only by nature; agents use `open_tab` on an existing window.
