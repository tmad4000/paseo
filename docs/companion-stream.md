# Companion and global Stream

Every managed conversation has Chat / Stream / Find in chat. The sidebar also opens
**Stream**, a private review feed across saved conversations on the app's paired hosts.
It is not a public/social feed and does not start agents, run models, or replay transcripts.

Global Stream interleaves questions, decisions, outcomes, pins and file references newest
first. Each card identifies its conversation, workspace path and host; opening it navigates
to that source chat through the existing workspace navigation owner. Per-chat Stream and
its file previews remain available. All / Needs a reply / Pinned, text search, host filtering,
and an explicit archived-chat toggle narrow the global feed. Internal agents are excluded.
The daemon reads its stored registry plus current live snapshots, so dormant conversations
participate without loading their providers. Pages use stable timestamp + identity cursors.
The app refreshes while the screen is focused and offers manual Refresh/Load more.
Offline host caches remain visible with a stale-data notice; failures and unsupported hosts
are named rather than silently treated as empty. Client caching is in-memory, not an offline
archive. Paired hosts are combined on the client; no additional cloud copy is made.

## Questions and pins

All captured entries are retained, including completed questions and old outcomes.
The 50-item bound applies only to wire snapshots and default read pages, never storage. Text remains bounded to **4,000** characters; Chat holds full context.
Sending an unrelated message never changes another question's status. Open, Reviewed and
legacy Reply sent questions remain unresolved until explicitly marked Done. Each item can
be resolved or reopened independently, including from global Stream. Pin removal is explicit.
A turn ending is not evidence its work shipped.

Agents should use **set_stream_question** for each needed input, with one stable questionId
per item. Reusing it edits the same entry, and status=done resolves only that question. This
tool defaults to the calling conversation and never approves a permission or sends a prompt.
Users can also add a question in the per-chat queue or a note in Pinned. Saves await an
acknowledged response, show failures, and preserve unsaved input after a failed save.
An acknowledgement follows durable storage. Manual question and pin drafts, including
artifact pins, retain their IDs across failed retries so a lost acknowledgement does not
create a second entry. Cached cards cannot be changed while their host is offline or lacks
the write capability.

Automatic capture is deliberately limited: final prose lines ending in a question mark,
and bullets beneath explicit English headings such as “Still need your input” or “Open
questions”, become separately identified questions. Recognition ignores code and URLs;
captured prose preserves inline code and URL context. Fenced code and standalone code or
URL examples are excluded. This syntax
heuristic is not a semantic inventory of every unanswered question. The explicit tool is
the reliable path, including other languages. Message inventory backfill is described below; this question heuristic does not backfill old events.
Existing retained Reply sent questions become visible again; previously evicted content
cannot be reconstructed by this change.

Structured provider questions and permission requests are captured immediately. Provider
resolution updates their status. When a provider request expires on interruption/recreation,
tool/plan approvals expire and cannot be granted from Stream. Needed input from an expired
question request remains as a manual open question that can be revisited in Chat.

Codex foreground turn IDs now include a fresh UUID. A recreated provider cannot restart its
counter at the same ID and suppress new Stream outcomes. Duplicate delivery of the same turn
still deduplicates. This does not repair previously missing historical cards.

## Durable ask checklist

Per-chat Stream opens on **Activity**, a superset of captured events, retained message
inventory, explicit asks, pins and artifacts. **Checklist** includes confirmed asks and
unreviewed user messages; unresolved work comes first. **Pinned** is item pinning, not the
separate conversation favorites feature. Named status (All/Open/Closed or Done) and source
(All sources/Your messages/Agent messages) controls expose their selected states. Counts are
computed across the full view before paging/status/source filters; the matching count reflects
those filters. Clear filters/Show all items recover a filter-empty view. Loading, disconnected,
failed, unsupported, no captured data and not-yet-loaded history are distinct states.

**Copy Stream link** emits the existing host/agent route with `?view=stream`: same-origin URLs
in browsers and `paseo-fork://` links in desktop/native. It adds no public host or sharing service.
The router retains the selection while the host bootstraps, and per-session Chat/Stream selection
is persisted locally so the workspace redirect/reload preserves it. Clipboard errors are visible.
Source-message buttons use the existing bounded Chat timeline jump. A stale timeline epoch
reports the existing history-load error rather than jumping to an unrelated row; refresh Stream
after Chat reloads its history.

### Message coverage versus semantic asks

New user messages are captured into durable source records, even before anyone opens Stream.
Opening the per-chat Stream or calling `list_stream_asks` indexes the currently loaded projected
Chat messages and awaits storage. This is foreground local indexing, not provider execution,
background inference, an additional model call, or transcript upload. Every retained user message
gets an **unreviewed** record, including ambiguous prose, multiple requests, and non-request
messages. Assistant questions remain agent messages. Legacy manually entered questions/asks
without a verified source remain unattributed; All sources includes them.

IDs hash role, full source text, and one provenance: the provider message ID when it is already
known, otherwise the client message ID. Indexing looks an existing record up under every provenance
the row carries (preferring a reviewed one), so a prompt that gains its provider ID later keeps its
record. When a row carrying several IDs matches a record, the other provenance hashes are kept as
`source.aliases` (re-indexed as soon as a provider ID enriches a submitted prompt), so a provider
history replay that carries only the provider ID — the normal case for Claude after a restart,
refresh or rewind — still finds the reviewed record. Without stable provenance, identity is scoped
to the timeline epoch and sequence range. Repeat indexing is idempotent. Text is part of the hash,
so a replay whose text differs from the submitted prompt (for example attachments rendered as
text) still creates another unreviewed observation. We deliberately prefer visible duplicate candidates over transferring
reviewed status or linked asks to a different identical message. Existing records, reviews and
ask links are preserved; only a proven identity can refresh their source position.
The original transcript is never rewritten. Excerpts are bounded to 4,000 characters; source links
open Chat. Old inventory records remain when a source later disappears. This is a coverage
inventory, **not a guarantee of automatic semantic ask extraction**. Human/agent review is still
needed to identify every request, including several requests in one message.

The production manager currently hydrates history through the existing provider history path;
its optional durable timeline-store interface is not wired to a production implementation here.
Indexing does not start that path or authenticate a provider. If older Chat history has not been
loaded, Stream says so and offers the path back to Chat. Refresh after loading retained history.
The loaded-history notice describes the messages available to Paseo, not completeness of the
provider's original lifetime history. Previously pruned Stream events are not recovered by this
index. If provider history is unavailable or truncated, coverage stays limited to retained records.
Legacy content/occurrence records are retained unchanged and are never matched to new
observations by text. Missing stable provenance prevents cross-epoch reconciliation; review
these unreviewed candidates against Chat rather than inferring identity or completeness.

For orchestration, read `list_stream_asks` at start/resume and review **every unreviewed message**:
create one stable ask per distinct request, reuse its `source.messageId` in every derived ask,
then call `review_stream_message` with the source entry ID, revision, note, and all linked ask IDs.
An explicit note is required even if the message contains no asks. Review completion means the
message was checked for requests, never that the tasks succeeded. Reopen source review with
`state=unreviewed` if extraction needs correction. Linked ask states remain independent.
This uses the orchestrator's existing tools/reasoning budget, without a new inference service.

Use the existing agent MCP interface:

1. `set_stream_ask` with a stable `askId`, `expectedRevision: 0`, the request `text`, and an
   `ask` object containing `state`, `remaining`, and `evidence` creates an ask.
2. `list_stream_asks` defaults to the caller's conversation. Follow `nextCursor` until null;
   use `unresolvedOnly: true` when reviewing outstanding work. Read the revision before editing.
3. Reuse the same ID and current `expectedRevision` with the full updated ask. States are
   `open`, `in_progress`, `blocked`, and `done`. Repeating an identical write after a lost
   acknowledgement is safe; a stale differing update returns a conflict rather than overwriting.
4. Record a blocker in `remaining`. Done requires nonempty evidence, empty remaining work,
   and every supplied subtask done. Reopen or correct the same ask with a new revision.

The ask belongs to its source conversation. Include `sourceMessageId` when known and
`delegatedAgentId` for a managed Paseo child; the card opens that session. Provider-native child
IDs are not Paseo IDs and must not be passed as delegatedAgentId. Optional subtasks each have a
stable ID, text, and explicit done boolean. A partial task remains in progress. No percentage is
invented when subtasks are absent. Evidence is an agent/user assertion, not independent verification.

Orchestrators should create one ask per request before delegation, keep IDs on the parent
conversation, and revise each ask when evidence or blockers change. Read unresolved asks on
resume. Explicit state and evidence remain an agent/user assertion, not independent verification.
The message inventory closes the silent-omission gap by leaving each message visibly unreviewed
until checked; it cannot promise every semantic ask is correctly extracted by an agent.
Neither a turn ending, a child becoming idle, source review, nor checked subtasks completes an ask.

Users can add an open ask in Checklist, reopen it or mark it in progress. Detailed progress,
blockers, corrections and completion evidence use `set_stream_ask` in v1; ask Done cannot bypass
that evidence contract through the old question status buttons. Completed asks stay accessible.
This change preserves history present at upgrade and subsequent captured entries. It does not
recover previously pruned records. Original provider history remains untouched.

Persistence remains in the existing atomic agent JSON record. Reads page the response; the
host still loads the complete per-agent metadata and sorts matching feed rows in memory. This
avoids a storage migration but is not a disk-indexed archive for unlimited scale. Entry excerpts
remain 4,000 characters. A refresh restarts pagination so state changes during browsing are visible.

## Protocol and ownership

`packages/protocol/src/companion-stream.ts` defines the existing entry shapes;
`global-stream.ts` defines additive `stream.list.request/response` and
`stream.entry.update.request/response` RPCs. `server_info.features.globalStream` gates global
reads and acknowledged writes; older hosts need updating. The old mutation RPC remains
accepted for old clients. Existing entry kinds/statuses and snapshot fields are unchanged.
Ask data is optional metadata on the existing question shape, with open/done mirrored for older
readers; no new entry kind or legacy status is emitted. `durableStream` advertises the original
explicit checklist; `streamMessageInventory` gates the extended per-chat Activity/Checklist UI,
message coverage and counts. New list scoping and mutation fields are additive and only used on capable hosts.
New response types are sent only when requested. Read/write permissions match other workspace
metadata operations. Mutation serialization prevents concurrent question/pin writes from
replacing each other, and missing items return errors rather than silent success.

The UI reuses Paseo theme tokens, headers, host picker, buttons and existing Stream cards.
No dependency update or new inference provider is needed.

## Verification

Collector, provider, manager, protocol and feed tests cover retention, unrelated replies,
per-item status, explicit lists, ID collisions, duplicate outcomes, pagination, filters,
internal/archived visibility and snapshot compatibility. The browser suite exercises the
connected global feed at desktop/phone widths, mutations and source-chat navigation.
Browser phone-width evidence is not native iPhone acceptance. Installing a new shared daemon
must follow the existing coordinated handoff procedure; do not restart the daemon hosting
active agents from a coding session.
