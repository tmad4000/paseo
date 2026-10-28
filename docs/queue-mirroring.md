# Queue Mirroring

Queued composer messages belong to the agent, not to the device that typed them. The daemon stores
the queue, broadcasts snapshots to connected clients, and drains it with no client attached. Voice
follow-ups use this same queue and [voice attachment receipts](voice-input.md#voice-while-an-agent-works).

## Why the queue moved

Before daemon ownership, the queue was entirely client-side and in memory:

- State is `queuedMessages: Map<agentId, QueuedComposerMessage[]>` on the per-server session slice in
  `packages/app/src/stores/session-store.ts`. Nothing persists it — not AsyncStorage, not
  localStorage. A reload loses the queue.
- The wire protocol has no queue concept. `rg queue packages/protocol/src` finds only GitHub merge
  queues. The daemon does not know a queue exists.
- The queueing client is also the draining client. `HostRuntime.drainQueuedAgentMessage`
  (`packages/app/src/runtime/host-runtime.ts:2138`) fires on the local `onAgentStoppedRunning` hook,
  pops the head, and calls `client.sendAgentMessage`.

Two consequences, and they are one bug:

1. Queue on the phone and the desktop never sees it.
2. If the phone disconnected, backgrounded, or the tab closed before the agent freed up, the message
   was never sent. Nothing else could send it because the daemon did not know the item.

Mirroring and delivery are the same fix. Moving ownership to the daemon gets both.

## Where the state lives

A daemon-scoped `AgentQueueService` plus an `AgentQueueStore`, modeled on `ScheduleService` /
`ScheduleStore` (`packages/server/src/server/schedule/`). Constructed once in `bootstrap.ts` next to
`scheduleService`, not per-session, so it survives zero connected clients.

Persist to `$PASEO_HOME/queues/{agentId}.json`, one file per agent, atomic write via
`writeJsonFileAtomic`, Zod-validated on read, new fields optional — the ordinary rules in
[data-model.md](data-model.md). Delete the file when the agent is deleted. Keep it on archive; an
archived agent that gets resumed should still have its queue.

Do not put the queue on `StoredAgentRecord`. That record is rewritten on every `emitState`, which is
a hot path, and queue items can carry image bytes. Separate lifetime, separate mutation cadence,
separate store — the store-surface rule in [data-model.md](data-model.md) wants the atomicity owned
by one store method per operation.

Persist across daemon restarts: yes. A queue that evaporates on restart reintroduces the delivery
bug it exists to fix.

Each queue mutation also writes a private JSON line to
`$PASEO_HOME/queues/{agentId}.journal.jsonl` before replacing the queue file. A record contains
the complete before and after states, including image bytes. The journal rotates at 64 MiB and
keeps one previous segment. Copy these files aside before a manual recovery attempt.

## Protocol

Dotted names per [rpc-namespacing.md](rpc-namespacing.md), in `packages/protocol/src/messages.ts`
alongside the other `agent.*` RPCs — the queue item reuses the attachment and forge-item schemas
defined there, and a separate module would import them in a cycle.

| Message                               | Direction | Purpose                                        |
| ------------------------------------- | --------- | ---------------------------------------------- |
| `agent.queue.enqueue.request`         | in        | Append an item                                 |
| `agent.queue.remove.request`          | in        | Cancel one item                                |
| `agent.queue.edit.request`            | in        | Edit an item's text without moving it          |
| `agent.queue.edit_hold.request`       | in        | Pause draining at an item while it is edited   |
| `agent.queue.send_now.request`        | in        | Send stored item with strict steering          |
| `agent.queue.reorder.request`         | in        | Reorder by explicit id list                    |
| `agent.queue.list.request`            | in        | Read the queue for one agent                   |
| `agent.queue.get_item_images.request` | in        | Fetch one item's image bytes                   |
| `agent.queue.inspect.request`         | in        | Host delivery state for `paseo queue ls`       |
| `client.outbox.report.request`        | in        | A device's unsent counts after a reconnect     |
| `agent.queue.update`                  | out       | Unsolicited snapshot broadcast; no `requestId` |

Each `.request` has the matching `.response`. `agent.queue.update` is a broadcast and follows
`agent.provider_subagents.update`, which is the existing precedent for an unsolicited agent-scoped
push.

Broadcast the whole queue for one agent, not deltas. Queues are a handful of items; a full snapshot
is self-healing and removes an entire class of drift. Carry a per-agent `revision` that increments on
every mutation so a client can drop a stale broadcast that arrives out of order.

Editing uses `itemId`, `expectedText`, and the replacement text. The daemon rejects a stale edit
or an item already claimed for delivery. It changes only the text, preserving the item's ID,
`createdAt`, attachments, images, and position. Both clients receive the next full snapshot.
The capability flag `queueEdit` prevents a newer client from sending this RPC to an older daemon.

Remove cancels one queued item without interrupting a running turn or undoing a delivered message.
An item already claimed for submission cannot be removed. For offline cancellation, see
[The un-acked window](#the-un-acked-window).

Send-now is a daemon operation gated by `queueSendNow`. It reads the authoritative stored item,
blocks concurrent edits, and sends that content with strict steering. On daemons with delivery
receipts, the item stays queued until dispatch is confirmed. A completed receipt is persisted
before removal, so a restart cannot send it twice. A refused steer leaves the item in its original
position. An uncertain outcome also leaves it queued for inspection without an automatic retry.

The wire item:

```ts
{
  id: string,                                          // client-generated, stable everywhere
  text: string,
  attachments: AgentAttachment[],                      // agent-side, for sending
  composerAttachments: QueuedComposerAttachment[],     // composer-side, for editing
  images: Array<{ id, mimeType, fileName, byteSize }>, // descriptors, not bytes
  createdAt: string,
}
```

Two attachment lists, because the agent-side form is lossy in reverse and a queued message has to
survive both a send and an edit. See [Attachments](#attachments).

Gate the feature once on `server_info.features.agentMessageQueue`. An old daemon has no queue, so a
new client keeps its existing local queue against that host; a new daemon plus an old client behaves
exactly as it does today, because the old client never sends the RPCs. No fallback branches inside
the feature — see [protocol-compatibility.md](protocol-compatibility.md).

## Broadcast fan-out

Each WebSocket connection builds its own `Session` and every `Session` subscribes to the shared
`AgentManager` and to the shared registries. That is why one client's action already reaches the
others: the daemon-scoped singleton emits once, every session forwards to its own socket.

`AgentQueueService` exposes `subscribeToMutations(listener)` in the shape
`ProjectRegistry.subscribeToMutations` already uses (`session.ts:1401`). `Session` subscribes in
`subscribeToOptionalManagers` and emits `agent.queue.update` to its client. Unsubscribe in the same
cleanup path as the other session subscriptions.

## Who drains

The daemon. `AgentQueueService` subscribes to `agentManager.subscribe()` and watches for the
`agent_state` running → idle transition — the same edge `checkAndSetAttention` keys off
(`agent-manager.ts:4300`). On that edge it pops the head and calls `sendPromptToAgent`
(`packages/server/src/server/agent/agent-prompt.ts`), which is the same function the
`send_agent_message_request` handler uses. Same prompt construction, same provider path, identical
agent-facing result.

Serialize drains per agent so a burst of state events cannot double-send. Keep the head until a
durable receipt confirms provider submission. If a competing turn reserves the run first, leave the
head in place and retry at the next idle boundary. A pending permission blocks drain even without a
foreground run. An ambiguous provider outcome remains unknown and is not retried automatically. A Codex start
cancelled before issuing `turn/start` reports `AGENT_PROMPT_NOT_SUBMITTED`, so its pending
receipt is cleared and the queue can retry at the next idle boundary. Do not classify a timeout
or a failure after issuing `turn/start` as safe to retry.

A successful direct-send RPC can report `queued: true`. The composer then retires its optimistic
chat bubble and submission activity; the daemon-owned queue remains visible until delivery. A
canonical provider echo that raced the response is preserved. Queue admission alone is not proof
that the agent received the message.

`wait_for_finish` observes pending dispatch before checking the provider's state. Admission can
precede run reservation, so an idle provider alone does not mean accepted input finished. A waiter's
timeout or disconnect stops only the observation; it cannot cancel delivery. An unresolved queued
outcome returns an error instead of a false idle result.

The client must stop draining when the feature is on, or both sides send. `drainQueuedAgentMessage`
becomes a no-op on hosts that advertise `agentMessageQueue`.

This is what makes the queue reliable rather than merely mirrored: with the daemon holding and
draining, a message queued on the phone is delivered whether or not the phone is still awake.

## Attachments

This is the only genuinely hard part, and it has two halves.

**Images cannot mirror by reference.** An image attachment carries `AttachmentMetadata` whose
`storageKey` points at device-local storage: IndexedDB on web, an absolute file path on desktop and
native (`packages/app/src/attachments/types.ts:9`). The bytes exist only on the device that queued
them. So the enqueue request carries the base64 data exactly as `send_agent_message_request` already
does, the daemon stores it, and the broadcast ships descriptors only — never the bytes — so a queue
holding a 5 MB photo does not push 6.7 MB of base64 at every phone on every mutation. On drain the
daemon reads the bytes back and hands them to `buildAgentPrompt`, so the agent sees exactly what a
direct send would have produced. `agent.queue.get_item_images.request` fetches them when a device
pulls the item back into its composer.

**The agent-side attachment form is lossy in reverse.** `splitComposerAttachmentsForSubmit` turns
workspace attachments into text, reshapes forge items, and flattens browser-element screenshots into
images. Nothing can turn that back into the pills the author saw. Storing only the agent-side form
would lose the original attachment metadata on a second device, so the item carries the composer-side
view of its non-image attachments as well. That list is device-independent by construction: it holds
uploaded-file handles, workspace file paths, and forge items, never a local storage key.

The inline editor changes only text; both attachment lists and image bytes stay on the daemon.

## Composer controls

Expand the queue, then tap a message to expand or collapse its full text. Scroll the queue to read
long messages; the queue and multiline editor scroll within bounded heights.

Save, Done, leaving the input, collapsing the queue, or leaving the workspace attempts to save
changed text. The existing draft store retains the local text and host baseline until the host
confirms the edit. A stale or failed edit stays recoverable; Done does not discard it.

### Editing while the queue drains

An open editor holds its message: the composer sends `agent.queue.edit_hold.request` with
`held: true` when editing starts, refreshes it every 20 s, and releases it when the edit is saved,
abandoned, or the row unmounts (after its save-on-leave request is in flight). While any device
holds the head item, the daemon does not drain it, so later messages also wait and order is kept.
A hold that stops being refreshed expires after 60 s, so a device that vanishes mid-edit stalls the
queue at most that long. Holds live in daemon memory only. Holding an item that is already being
sent fails. Send now ignores holds: it is an explicit request to send.

If the message still leaves the queue mid-edit (Send now from another device, a removal elsewhere,
a host without `queueEditHold`, or a drain that claimed it first), the editor stays open with the
draft and says the message left the queue. **Queue as new message** queues the edited text as a new
message without touching the composer's own draft; **Discard edit** drops it. Such an edit stays
visible when the queue is collapsed, and a `:detached` marker in the draft store brings it back after
switching chats or reloading. Save no longer reports "This message is no longer queued."

Clearing all the text of a message with no attachments turns Save into Remove: Save or Done then
removes the item through the normal Remove path. Leaving the input or the screen with empty text
keeps the empty draft open instead, so a stray tap cannot delete a message.

Remove is available for host-accepted rows and rows waiting to sync. While removal is unconfirmed,
the row shows pending or failure feedback and cannot be edited or sent now. Tap Remove to retry a
failed removal; reconnect also retries it.

## Reconciliation

The server is authoritative. Session state stores only daemon snapshots; the composer overlays
durable local outbox entries until the daemon acknowledges enqueue or removal:

1. Before clearing the composer or attempting delivery, enqueue persists a full local outbox entry.
   The composer shows it as waiting to sync until an authoritative snapshot includes its id.
2. `agent.queue.update` replaces the stored list for that agent whenever its revision is current or
   newer. Outbox rows stay visible as a separate overlay and become daemon-accepted queue items only
   when a snapshot confirms their ids.
3. On reconnect the client calls `agent.queue.list.request` for visible agents, or takes the snapshot
   the daemon pushes on subscribe. Reconnect and mutation take the same path, so there is no separate
   resync path to keep correct.

Keep the overlay out of session snapshot state so removing an acknowledged outbox entry also removes
its local row.

## The un-acked window

Between tapping queue and the daemon acknowledging enqueue, the device owns delivery.
The local write must be durable before attempting the request, so a stalled relay,
iOS suspension, or app restart cannot lose the item before the daemon knows about it.

The outbox (`packages/app/src/stores/queue-outbox-store/`) persists the full wire
payload — image bytes included — before clearing the draft or attempting delivery.
Encoding or storage failure keeps the draft and attachments and displays an error.
A failed send keeps its durable entry and visible row for retry; after repeated
failures the client shows one attention message and continues retrying.

On every (re)connect that advertises `agentMessageQueue` (the `server_info`
status message, which is exactly the re-established-transport signal), the
session flushes eligible outbox entries oldest first within each agent.
Listen for that message with a raw `client.on("status")` handler
(`contexts/session-outbox-flush.ts`). The daemon sends the connect-time
`server_info` before any owned `observeEvents` subscription exists, so a feed
subscriber never receives it. From 2026-09-28 to 2026-10-22 the flush listened on
the feed and never ran on reconnect, leaving rows on "Waiting to sync with host"
indefinitely. The same helper also flushes once at mount when the client is
already connected, because a cold start can connect before the session context
subscribes. Enqueue entries use
the ordinary enqueue RPC; removal intents use the remove RPC and are never
re-enqueued. A failed predecessor blocks later items for that agent while other
agents proceed. Re-sending an enqueue is safe because the daemon treats a
known item id as a retry:

- an id already in the queue is a no-op (this existed from the start), and
- an id in the queue's `drainedIds` — a capped memory of recently delivered
  items — is also a no-op, so a retry that lands _after_ the item was drained
  cannot deliver it twice. A failed drain removes the id again so the restored
  item stays sendable.

Snapshots still replace the local list wholesale. The composer uses
`appendPendingQueueRows` to overlay un-acked outbox rows on the stored snapshot.
Keep that overlay out of session snapshot state so acknowledging an outbox entry
also removes its local row. Equal-revision snapshots reconcile optimistic rows;
older revisions remain ignored. An entry that keeps failing stays in the
device's durable outbox and visible queue. At `QUEUE_OUTBOX_MAX_ATTEMPTS` failed
reconnects, the client shows an attention message once; future reconnects keep
retrying. A host acknowledgement permits durable outbox removal. Routing adds dispatch holds and
draft checkpoints before removal; [session routing](session-routing.md) owns those constraints and
definitive destination rejection recovery. Rows absent from
the latest authoritative snapshot are labeled "Waiting to sync with host" unless
removal is pending, and cannot be edited or sent from the daemon queue. Inclusion in a snapshot
acknowledges an enqueue only when no removal intent is pending. Persist removal intent
before attempting the remove RPC. The intent survives snapshots that still include
its item; after the RPC is acknowledged, persist its deletion from the outbox.
This also reconciles a lost enqueue response without resending the canceled payload.

## Direct sends

A direct send (Enter, Steer, Interrupt, or Send now from the composer) has the same un-acked
window as a queued message. Before 2026-10-22 it had no durable copy: the composer cleared the
draft, awaited the RPC for up to 60 seconds, and restored the text only on failure. An app kill or
iOS suspension in that window lost the message (reproduced against a SIGSTOPped daemon).

The send outbox (`packages/app/src/stores/send-outbox-store/`) closes it. When the host
dedupes retried sends, `dispatchComposerAgentMessage` stores the full request under its
client message id before sending. That requires both `agentRequestReceipts` (steer and interrupt
receipts) and `agentMessageQueue` (queue item ids for ordinary input). It then sends through the same
per-agent ordered flush that reconnects use:

- Accepted: the entry is removed and the optimistic bubble proceeds as before.
- Anything that is not a definitive answer (connection loss, timeouts, a client closed or replaced
  mid-request): the entry stays, the bubble
  stays with its pending mark, and the composer does not take the text back. Every reconnect and
  cold start resends the **identical** request. The daemon's receipt (or queue item id) makes a
  retry of a request that did arrive a no-op. Changing the active-turn behavior would change the
  receipt fingerprint, so retries never rewrite it, even when an interrupt arrives late.
- A definitive answer (`AgentMessageRejectedError` from `accepted: false`, a `DaemonRpcError`,
  or a request that cannot be built): while the author is sending, the entry is removed and the
  text returns to the composer with the error, as before. A refusal during a background flush
  parks the entry with `rejectedError`; it is not retried until the user taps Retry. Classify
  refusals positively. Any unrecognized error means "unknown", never "refused", because handing an
  arrived message back to the composer turns the user's resend into a duplicate.
- `agent_request_outcome_unknown` arrives as a refusal, but the host may have delivered the message.
  It stays parked with its own explanation and never returns to the composer. Edit is offered only
  for definitive refusals of plain-text messages, since the outbox does not keep composer attachments.

A send failure stops that agent's later entries so they cannot overtake it. A refusal does not.
The outbox remembers per host that it supports durable sends (`durableHosts`). A cold start with the
host unreachable, before its features are known, can still store a send first. The reconnect flush
itself checks the live features, so a downgraded daemon is never sent retries it cannot dedupe.

Entries with no live chat bubble appear in the composer's **Unsent messages** track: after a
relaunch, or for another chat's sends. Each row offers Retry, Discard, and, for refused messages, Edit,
which moves the text back into the message box. Only a refused message may be edited. One that is
still retrying could already be on the host.

## Delivery marks

The user's own messages carry a messaging-app style tick
(`composer/delivery-state.ts`, rendered by `components/delivery-mark.tsx`):

| Mark         | Chat bubble                                                  | Queued row                                       |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| Clock        | Optimistic, host has not answered (`rpcSettled` false)       | Outbox entry not in the latest host snapshot     |
| Check        | Host accepted the send; provider echo not seen yet           | In the host queue: "On the host"                 |
| Double check | Canonical timeline row (has `messageId` or `timelineCursor`) | Never; a drained item becomes a delivered bubble |
| Alert        | Outbox entry refused or at `SEND_OUTBOX_MAX_ATTEMPTS`        | Outbox entry at `QUEUE_OUTBOX_MAX_ATTEMPTS`      |

Clock, check and alert stay visible on every platform. The double check joins the timestamp row,
which desktop reveals on hover. The alert never stops retries; it only tells the user. Tapping a
bubble's alert explains it and offers Retry now.

## Delivery inspection

`paseo queue ls <agent>` shows the host's view of delivery for one agent, gated on
`deliveryInspect`:

- **Queued on the host:** the daemon queue, with creation times.
- **Recently delivered:** items that left the queue for the agent, newest first, with time and a
  one-line preview. The store derives `drainedLog` from `drainedIds` inside `mutate()`, so every
  drain path records it and a failed drain that restores the item removes its entry. Items
  drained before this existed show an unknown time.
- **Delivery receipts:** direct-send and drain receipts. `completed` means the provider accepted
  the message; `pending` means the host stopped mid-submit and the outcome is unknown.
- **Devices reporting unsent messages:** after each reconnect flush settles, a client sends
  `client.outbox.report.request` with per-agent counts of queued and direct messages still in
  its outbox, plus the oldest one's time. Reports are held in memory, replaced per client id
  and capped at 64 devices; they reset when the daemon restarts and refill as devices reconnect.

The limit is fundamental: a message saved on a device that has not reconnected exists only on
that device. The host cannot see it, and neither can the CLI. A report says only "this device
held N unsent messages at time T", never their text.

## Known edges

Both outboxes are only as durable as the platform's `AsyncStorage`. On iOS and Android a write is
on disk when `setItem` resolves, and the outboxes wait for it before sending. On web and Electron
`AsyncStorage` is Chromium localStorage, which commits to disk in batches. A crash or SIGKILL within
a few seconds of a write can drop it; a normal quit or tab close flushes. Reproduced: a kill 3 s
after sending lost the entry, while a kill 15 s after it was delivered exactly once.

Never `set()` a persisted outbox store before it has rehydrated. Persist writes the in-memory
state, so an early write replaces the saved entries with the empty initial state. Every mutation
awaits hydration first (`send-outbox-store/index.test.ts` covers the connect-time case).

`agent.queue.reorder.request` has a schema and a handler but no UI. Today's composer has no reorder
affordance; adding one is a separate change.

A message claimed for delivery just before its editor's hold arrives is still sent with its old
text. The edit survives as a detached draft (see
[Editing while the queue drains](#editing-while-the-queue-drains)), but the agent has already
received the original.

Nothing drains on daemon startup. Queues persist across a restart, but a leftover item waits for the
next running → idle edge or the next enqueue rather than resuming the agent at boot. Auto-starting
agents when the daemon comes up is a bigger behavior change than mirroring, and it belongs in its
own decision.

With delivery receipts, send-now claims the stored item in place and removes it only
after confirmed dispatch. A failed or unsupported steer leaves it at its original
position for recovery. Older hosts without receipts temporarily claim and restore
the item around a send attempt.
