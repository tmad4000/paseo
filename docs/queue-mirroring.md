# Queue Mirroring

Queued composer messages belong to the agent, not to the device that typed them. This doc describes
moving the message queue from client memory onto the daemon so every connected client sees the same
queue and the daemon drains it with no client attached.

## What it looks like today

The queue is entirely client-side and in memory:

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
2. If the phone disconnects, backgrounds, or the tab closes before the agent frees up, the message is
   never sent. Nothing else will send it — no other client has the item, and the daemon was never
   told.

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

## Protocol

Dotted names per [rpc-namespacing.md](rpc-namespacing.md), in `packages/protocol/src/messages.ts`
alongside the other `agent.*` RPCs — the queue item reuses the attachment and forge-item schemas
defined there, and a separate module would import them in a cycle.

| Message                               | Direction | Purpose                                        |
| ------------------------------------- | --------- | ---------------------------------------------- |
| `agent.queue.enqueue.request`         | in        | Append an item                                 |
| `agent.queue.remove.request`          | in        | Cancel one item                                |
| `agent.queue.reorder.request`         | in        | Reorder by explicit id list                    |
| `agent.queue.list.request`            | in        | Read the queue for one agent                   |
| `agent.queue.get_item_images.request` | in        | Fetch one item's image bytes                   |
| `agent.queue.update`                  | out       | Unsolicited snapshot broadcast; no `requestId` |

Each `.request` has the matching `.response`. `agent.queue.update` is a broadcast and follows
`agent.provider_subagents.update`, which is the existing precedent for an unsolicited agent-scoped
push.

Broadcast the whole queue for one agent, not deltas. Queues are a handful of items; a full snapshot
is self-healing and removes an entire class of drift. Carry a per-agent `revision` that increments on
every mutation so a client can drop a stale broadcast that arrives out of order.

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

Serialize drains per agent so a burst of state events cannot double-send. On send failure, put the
item back at the head and broadcast; do not silently drop.

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
would make Edit on a second device silently drop attachments, so the item carries the composer-side
view of its non-image attachments as well. That list is device-independent by construction: it holds
uploaded-file handles, workspace file paths, and forge items, never a local storage key.

Edit therefore restores the same content on every device: text, the composer-side attachments, and
the images fetched back from the daemon.

## Reconciliation

The server is authoritative. The client keeps its optimistic write and lets the next snapshot
replace it:

1. On enqueue the client generates the item id, writes the item into its local list immediately, and
   sends `agent.queue.enqueue.request` — the composer clears without waiting for a round trip.
2. `agent.queue.update` replaces the whole local list for that agent whenever `revision` is newer.
   An optimistic item that the server accepted survives because the ids match; one the server
   rejected disappears on the next snapshot.
3. On reconnect the client calls `agent.queue.list.request` for visible agents, or takes the snapshot
   the daemon pushes on subscribe. Reconnect and mutation take the same path, so there is no separate
   resync path to keep correct.

Do not merge local and server lists. Last snapshot wins.

## Known edges

`agent.queue.reorder.request` has a schema and a handler but no UI. Today's composer has no reorder
affordance; adding one is a separate change.

Nothing drains on daemon startup. Queues persist across a restart, but a leftover item waits for the
next running → idle edge or the next enqueue rather than resuming the agent at boot. Auto-starting
agents when the daemon comes up is a bigger behavior change than mirroring, and it belongs in its
own decision.

Send-now on a daemon-backed queue takes the message off the queue before sending, because the daemon
drains the same queue and leaving it there would risk sending twice. If that send then fails, the
message is requeued at the end rather than where it was — the queue has no insert-at-position.
