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

Pin a user message or completed assistant response using its pin menu. Right-click an
assistant item (long-press on native) to pin that item independently. A text selection
inside that item adds **Pin selected text to Stream** on web and desktop. **Pin excerpt…**
opens an editable passage on every platform. Messages longer than 4,000 characters open
the excerpt editor rather than silently truncating. Pins appear in Activity and Pinned,
including global Stream. Saves wait for durable acknowledgement, show progress and errors,
and retain an unsaved excerpt and its retry identity after failure.

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

## Cards

Each card leads with its content. One muted eyebrow line combines kind, state and time
(“Ask · In progress · Oct 24, 2:10 PM”); the first line of the entry text is the headline and
the rest is body copy. Evidence, remaining work, subtasks, source message and delegation
stay behind **Read**. Tracked asks are labelled **Ask**: every tracked ask is explicit, so
the word is not shown; `ask.provenance` stays in data. A pin with a `sourceId` (a saved
excerpt or quoted chat item) renders as a **Quote**: the passage itself, larger, with a
left rule and an **Open source chat** action. Opening the chat does not yet scroll to the
quoted item. Card strings live in `agentPanel.stream.card` (English fallbacks in other locales).

## Tags

Tags follow the Thoughtstream convention: inline `#hashtags` in pin, note, question, ask or
Q&A text. A tag starts with a letter and continues with letters, digits, `-` or `_`; tags are
lowercased and de-duplicated, and hashtags inside code spans, fenced code or URLs are ignored
(`#123`, `C#` and `a&#39;b` are not tags). Inferred questions, permissions and turn outcomes
quote provider output and are never tagged. The host parses tags when an entry is written or
updated into the additive optional `CompanionEntry.tags`; entries saved before tags existed
are parsed on read without being rewritten. No storage migration; older hosts ignore the field.

`stream.list.request` accepts `tags: string[]` (an entry must carry every tag) in both
per-chat and global scope. The response adds `tagCounts` for the scope and other filters
(search, pending/pinned, checklist, archived), deliberately ignoring the tag filter itself so
chips stay in place while toggled, plus `pinnedTags` for the scope. Clients send `tags` only to
hosts advertising `server_info.features.streamTags`; rows from other hosts are filtered
client-side by parsing their text.

Pinned tags are per chat (stored as `pinnedStreamTags` on the agent record and carried across
snapshot flushes like `archivedAt`) or host-wide (`$PASEO_HOME/stream-tags.json`). The sibling
RPC `stream.tags.pin.request` (`agentId` optional, `tag`, `pinned`) returns the new list; at
most 50 per scope. In global Stream across several hosts, pinning applies to every connected
host that supports tags.

Per-chat and global Stream show a compact tag cloud under the header: pinned tags first with
a pin glyph, then by count, with a mild size step for the most-used tags. Tap a chip to toggle
it in the filter; long-press (or the accessibility action) pins or unpins it. Active tags show
as removable chips with a pin toggle above the cloud. Hashtags in card text are links that add
the tag to the filter. The note composer and the **Pin excerpt…** sheet have a tags field that
suggests existing host tags and appends chosen tags to the text as `#tags`. Per-chat Stream
also gains a text search box (the host's existing `search` option).

Agents pin quotes with **pin_stream_quote** (`text`, optional `tags`, `sourceId` such as
`msg:<id>`, and a stable `pinId` to edit). Tags are appended as hashtags; the result reports
the parsed tags.

## Durable ask checklist

Per-chat Stream opens on **Activity**, including completed replies and saved pins.
**Checklist** shows explicitly tracked asks; it is empty when no agent has recorded one,
even when Activity contains captured replies. Its empty state links back to Activity.
Use **Show unresolved only** to focus on outstanding entries, **Show completed too** to
restore completed work, and **Load more** to read older pages. Pinned shows saved pins.
Refresh and reconnect reread durable records;
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
reads and acknowledged writes; older hosts need updating. `streamTags` gates tag filters, counts, pinned
tags and `stream.tags.pin.request`. The old mutation RPC remains
accepted for old clients. Existing entry kinds/statuses and snapshot fields are unchanged.
Ask data is optional metadata on the existing question shape, with open/done mirrored for older
readers; no new entry kind or legacy status is emitted. `durableStream` gates per-chat pagination
and checklist. New list scoping and mutation fields are additive and only used on capable hosts.
New response types are sent only when requested. Read/write permissions match other workspace
metadata operations. Mutation serialization prevents concurrent question/pin writes from
replacing each other, and missing items return errors rather than silent success.

The UI reuses Paseo theme tokens, headers, host picker, buttons and existing Stream cards.
No dependency update or new inference provider is needed.

## Verification

Card and tag browser evidence (`stream-tags.spec.ts`, `global-stream.spec.ts`): card hierarchy
[phone](stream-tags/card-hierarchy-phone.png) / [desktop](stream-tags/card-hierarchy-desktop.png);
global tag cloud [1440](stream-tags/global-stream-tags-1440.png) / [390](stream-tags/global-stream-tags-390.png);
per-chat cloud and tagged note composer [1440](stream-tags/chat-stream-tags-1440.png) /
[390](stream-tags/chat-stream-tags-390.png); [Quote card](stream-tags/quote-card-390.png).

Pinning browser evidence: [phone excerpt retry](stream-pins/excerpt-retry-phone.png) and
[desktop Activity](stream-pins/activity-desktop.png). The global Stream browser suite also
checks user/assistant/item/selection pins, failed-write recovery, reload, and completed replies
appearing without an explicit ask. These use the app's existing theme and controls.

Collector, provider, manager, protocol and feed tests cover retention, unrelated replies,
per-item status, explicit lists, ID collisions, duplicate outcomes, pagination, filters,
internal/archived visibility and snapshot compatibility. The browser suite exercises the
connected global feed at desktop/phone widths, mutations and source-chat navigation.
Browser phone-width evidence is not native iPhone acceptance. Installing a new shared daemon
must follow the existing coordinated handoff procedure; do not restart the daemon hosting
active agents from a coding session.
