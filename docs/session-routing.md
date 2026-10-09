# Find and route to existing chats

The project sidebar combines its immediate project/title filter with deliberate intelligent Find
and Send prompt actions. Find and Open chat never deliver the query. Use this chat pins an exact
host/session, switches to Send, and restores the independent, persisted send draft. The destination
chat owns all replies; sending to an existing chat does not navigate away or create a session. Press Enter/Search in the
filter field or choose Find to submit intelligent matching; typing alone keeps the ordinary filter.

Choose All projects, Current project, or a named project in the scope menu. A project scope is a
sidebar project view identity, including its host/clone grouping. Search sends only that scope's
workspace IDs to each host. Changing scope clears a selected recipient outside it. Scope and selected
host changes invalidate matching successes and failures in either mode. Editing the Find query or
Send draft keeps the previous results visible until an explicit new lookup replaces them. Those
results describe the submitted lookup, not a live search of the edited text. A new lookup captures
its query or durable draft revision; later edits cancel that request's ownership so its late response
cannot replace a newer lookup. Explicit Clear removes the active input and its results, while leaving
the other mode's independent input intact. Cancellation releases only the canceled request's loading
state, even if a newer lookup has started. Host changes
also clear excluded results and editable recipients; a pending delivery keeps its original destination
and item ID until acknowledgement or rejection. Explicit recipient selection
bypasses matching. In Send mode, **Find first** only presents candidate chats, including when one
match has high confidence. Passive matching never selects a destination; delivery through Find
first requires an explicit destination choice and uses the current saved draft. The one exception
is the explicit **Route to best match** verb below: invoking it is itself the destination decision,
and it may deliver without a per-candidate choice only under its documented threshold-and-margin
gate. Once a destination is selected, the main action names its actual delivery mode: Queue,
Steer, or Interrupt. Find remains search-only.
In Find results, Open chat navigates and Use this chat selects without sending. In Send results,
the Queue here, Steer here, or Interrupt here action delivers the current saved prompt to that chat. Choose an existing chat opens the manual
picker when matching returns no results. Routing requires a host advertising `sessionSearch`;
delivery also requires `agentMessageQueue`. Update an older host when prompted.

## Route to best match

**Route to best match** is an explicit verb on a drafted Send prompt — a keyboard-accessible
button beside the main Send action — that chains one search, one selection decision, and one
delivery. It is user-invoked every time; typing, editing, or passive Find/Send matching never
triggers it. It is available only while no recipient is pinned and New conversation is not
selected: explicit recipient selection already bypasses matching, so the verb disables rather
than silently re-routing a pinned destination.

The verb auto-selects the top match only when both configurable gates hold
(`ROUTE_AUTO_SELECT_MIN_CONFIDENCE` and `ROUTE_AUTO_SELECT_MIN_MARGIN` in
`packages/app/src/components/sidebar/session-routing/model.ts`): the top result's confidence must
reach **0.85**, and it must lead the runner-up by at least **0.2** (a missing runner-up counts as
0). The matcher reserves 0.90+ for a conversation the user clearly identifies, so these defaults
are deliberately conservative; vague prompts fall back to a choice. A search with any failed or
unhydrated host never auto-selects, because the missing host could hold the real destination.
When the gate does not clear, the verb falls back to the existing candidate-choice UI with the
draft preserved and nothing sent; when there is no match at all, it additionally offers starting
a new conversation with the same draft through the existing New conversation handoff.

Route delivery is **queue-mode only** (`deliverRoutedPrompt`): the verb never steers or
interrupts a running agent, regardless of the currently selected delivery mode, and it keeps the
durable outbox contract, atomic destination guard, and retry idempotency unchanged. The
post-route receipt names the destination project and chat and offers **Wrong chat? Move draft**,
which restores the routed text as the editable draft (never overwriting a newer edit) and reopens
the manual chooser. Moving the draft does not recall the already-queued item; cancel it from the
destination's queue if it should not run.

The verb submits the search with the composer's current scope. The default scope is All
projects — deliberately, because a project scope excludes chats whose workspaces live elsewhere
(for example tmpworkspace scratch chats, per the project-identity rule below) — and an explicitly
chosen scope is respected exactly like any other lookup.

## New conversation and delivery mode

Send mode offers **New conversation** directly, independently of intelligent matching.
Its visible workspace picker identifies the project, workspace, and host. Under All projects,
the default is the selected host's uniquely identified `tmpworkspace` root. An explicit project
scope uses the active workspace within that project, or its sole workspace. Missing scratch
workspaces, ambiguous choices, or multiple hosts without host context require a selection; the
UI never guesses an unrelated workspace. Manual choice survives toggling destinations until
scope or host selection excludes it.

**Continue in new conversation** saves an independent draft, waits for durable persistence,
then opens the chosen workspace's ordinary new-chat composer. The user chooses the provider/model
and sends there using the established composer. Neither selecting a workspace nor Continue
sends the prompt. The original dispatcher draft is retained as a copy; editing the new draft
does not change it. Controls lock during handoff, and the captured destination is revalidated
after persistence. A failure preserves the source prompt.

Existing-chat delivery offers **Queue** (default), **Steer**, and **Interrupt**. Queue retains
the durable outbox contract below. Steer and Interrupt use the ordinary chat composer submission
path and require an explicitly selected conversation; intelligent matching presents candidates
rather than automatically steering or interrupting one. Steer uses strict `steer_only` and never
falls back to interruption. Active steering requires the host capability; idle sending follows
the ordinary composer's compatibility behavior. Interrupt sets the cancellation flag only for
an active turn. Both recheck host, chat/workspace identity, project, and scope immediately before
sending. The direct-send protocol has no atomic expected-workspace guard, so this is a preflight
check rather than Queue's atomic admission guarantee.

Direct sends are never replayed by the queue outbox. An uncertain response preserves the draft
and tells the user to inspect the destination before resending. A successful send remains
acknowledged even if saved-draft cleanup fails; the receipt warns about the restored draft
without offering a delivery retry. Later edits are protected by draft revision and timestamp.

`session.search.request` reuses existing agent/project/workspace metadata and the latest conversation
context, including daemon-acknowledged queued messages (pending work, not delivered messages).
Device-only drafts and unsent outbox items are not visible to host search. Each host shortlists at most
100 sessions before reading timelines; results expose
searched/total counts. Evidence snippets come verbatim from supplied context, and returned IDs and
evidence indexes are validated. Archived and child/internal agents are excluded. No maintained index
is required. Queue text participates in shortlisting. For each shortlisted chat, Find reads up to
400 projected timeline entries and supplies up to six recent messages plus six query hits, with excerpts capped
at 800 characters around matching text. This is bounded recent-context matching, not full-history search.
Results show local date, time, and timezone for the session update and evidence message. The session
update time includes newer queued-message creation times; queued evidence is labeled explicitly.
Older hosts omit the optional timestamps.

A chat belongs to its workspace's project even when its messages discuss another product. For
example, a Vision discussion started in tmpworkspace is excluded by the Vision project scope;
use All projects to find it.

Semantic matching uses the enabled built-in Codex provider and the existing ChatGPT file sign-in in
its exact `CODEX_HOME` (or the provider environment's `HOME/.codex`). It reads the effective saved
GPT model/reasoning default through `config/read`. When no model is saved, it uses only Codex's
declared account default; missing reasoning effort comes from the selected model's declared default
when available. It never substitutes a coding chat's model, shared Git metadata-generation
configuration, Claude, or another provider. All providers remain valid destination sessions.
Unsupported custom inference endpoints, keychain-only/API-key sign-in, unavailable defaults, expired
sign-in, and account limits fail clearly; ordinary filtering and the manual recipient picker remain
usable. An unrelated `OPENAI_API_KEY` inherited from the login shell does not replace this explicit
ChatGPT sign-in or prevent matching. An explicit Paseo provider-key override, Codex API-key override,
or custom endpoint remains unsupported. Coding-session environments are unchanged.
Normal Codex owns authentication refresh; matching never rewrites authentication or config.

The routing-only matcher uses Codex's existing ChatGPT-authenticated
[Responses transport](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/core/src/client.rs)
and [backend endpoint](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/model-provider-info/src/lib.rs).
This is Codex's backend protocol, not public API-key support for ChatGPT tokens. Every request sends
`tools: []`, `tool_choice: "none"`, and `store: false`, with only classification instructions and the
supplied query/candidate context. No native thread or agent runtime is created, so MCP, instructions
files, hooks, skills, subagents, and coding-session grants cannot enter the matcher. The fixed endpoint
rejects redirects. Streaming and output sizes are bounded; partial, tool, refusal, malformed, and
model-mismatched responses fail closed. Codex can deliver completed messages in `output_item.done`
while leaving terminal `response.output` empty. Those messages are accepted only after a completed
terminal acknowledgement confirms the configured model; text deltas alone are insufficient.
Successful generation logs the requested and actual response
model without query, context, or credentials. Schema validation and scoped candidate/evidence
validation still apply after generation.

A connection supersedes its prior matcher and aborts after 45 seconds, including configuration
resolution and streaming. Fixture tests exercise the real SDK request consumer and a local Codex
JSON-RPC subprocess; they never send tasks to real agents. Live inference and installed runtime
acceptance are recorded separately.
Routing copy remains English across locales in v1.

Delivery uses the daemon queue and the existing durable device outbox, preserving the original text
and a stable item ID for retries. Active tasks are queued without interruption. Routing supplies
expected workspace/project IDs; a new enqueue rejects a moved, archived, or deleted destination.
Workspace moves cannot interleave with destination validation and durable new-item admission. The queue
checks accepted item IDs and durable receipts before that guard, so retries after an accepted send
remain idempotent even if the destination subsequently moves or is deleted. Pending receipts retain
uncertain ownership. Fresh device items stay held out of reconnect delivery through draft/outbox
checkpoints; the current host selection is checked again before direct delivery. Every routed enqueue,
including reconnect retries, requires `sessionSearch` and `agentMessageQueue` from the current
connection at the serialized dispatch boundary, after any awaited durable writes. A saved routed
item stays pending after a host rollback until that host can validate its expected destination again;
this capability hold preserves ownership without acknowledging the item or increasing retry attempts.
Ordinary queue items and cancellation remain usable.
A definitive rejection releases the
pending submission only after durable outbox removal succeeds and preserves its editable draft; a missing acknowledgement retains the durable
item and shows an uncertain delivery state. A failed dispatch-marker write preserves a real host
acknowledgement. Without one, explicit Retry recovers the same item; reloading alone never makes held
items eligible for reconnect delivery. Background reconnect publishes actual acknowledgements
or definitive rejections to the composer. A cancellation stays pending until the host confirms
removal and the device checkpoints it. Cancellation requested during a draft-clear checkpoint
suppresses success and checkpoints restoration of that owned draft before releasing the outbox.
A later draft stays intact. If the cancellation checkpoint fails after success was suppressed,
acknowledgement cleanup retains the original outbox item for recovery with the same ID. Flush and
snapshot reconciliation honor suppression without replaying the accepted snapshot into another
acknowledgement.
Completion reports queue removal and preserves the editable draft; Retry requires the original uncanceled outbox item and cannot recreate a removed one.
Held enqueue entries still allow durable cancellation on older hosts. Queued for means the host acknowledged an item still in its
queue; Routed to means the acknowledgement no longer lists it. Neither confirms task completion.
The composer waits for both persisted drafts and the outbox before enabling Send. Pending recovery
does not require a loaded host/chat directory. Routing keeps durable outbox ownership until the draft
checkpoint succeeds, including after a failed storage write. Acknowledgement waits for persisted draft
hydration before comparing ownership. Checkpoint writes serialize with background draft writes;
failure restores matching in-memory draft ownership and retains the same outbox item for retry.
A tentative clear persists its item identity with the cleared revision in the same draft record.
On reload, that identity lets the retained outbox recover the original ownership before the composer
unlocks; a later user draft has no matching clear identity and stays intact.
Draft clearing is guarded by the submitted
draft revision and update timestamp, so a late
acknowledgement cannot erase a newly edited identical prompt. See [queue mirroring](queue-mirroring.md)
for the shared outbox and delivery-receipt contract.
