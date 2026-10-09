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
**set_stream_pin** gives agents the same durable write for Pinned: create returns a stable
pinId, reusing it edits the same pin (full replacement), and remove=true deletes it — removing
an already-removed pin succeeds, so retries after a lost acknowledgement are safe. A pin may
carry an optional source conversation (`sourceAgentId`, rendered as an open-session action)
and an optional `link` URL. Both Stream write tools default to the calling conversation;
set_stream_pin also accepts another conversation's id or exact unique title so an
orchestrator can curate a hub conversation it owns. An ambiguous or unknown title is an
error, never a silent fallback.
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
the reliable path, including other languages. No historical transcript backfill is claimed.
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

Per-chat Stream opens on **Checklist**, showing unresolved explicitly tracked asks first.
Use **Show completed too** to include completed work, and **Load more** to read older pages.
Queue and Pinned retain their existing meanings. Refresh and reconnect reread durable records;
offline pages remain readable with a stale-data notice. Cached data is not an offline archive.

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
resume. This is an explicit tool contract, not automatic semantic extraction: natural-language
requests are not guaranteed to be inventoried unless the orchestrator records them. No background
model, paid API, agent execution loop, provider-history edit, or transcript backfill is added.
Automatic question cards remain distinct from explicit asks. Neither a turn ending, a child
becoming idle, nor all subtasks being checked automatically completes an ask.

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
accepted for old clients. Existing entry kinds/statuses and snapshot fields are unchanged;
pin entries carry additive optional `sourceAgentId` and `link` fields that old readers ignore.
Ask data is optional metadata on the existing question shape, with open/done mirrored for older
readers; no new entry kind or legacy status is emitted. `durableStream` gates per-chat pagination
and checklist. New list scoping and mutation fields are additive and only used on capable hosts.
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
