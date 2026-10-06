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

Unanswered questions and pinned notes are retained independently of the most recent **50**
other entries. Text remains bounded to **4,000** characters; Chat holds full context.
Sending an unrelated message never changes another question's status. Open, Reviewed and
legacy Reply sent questions remain unresolved until explicitly marked Done. Each item can
be resolved or reopened independently, including from global Stream. Pin removal is explicit.
A turn ending is not evidence its work shipped.

Agents should use **set_stream_question** for each needed input, with one stable questionId
per item. Reusing it edits the same entry, and status=done resolves only that question. This
tool defaults to the calling conversation and never approves a permission or sends a prompt.
Users can also add a question in the per-chat queue or a note in Pinned. Saves await an
acknowledged response, show failures, and preserve unsaved input after a failed save.

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

## Protocol and ownership

`packages/protocol/src/companion-stream.ts` defines the existing entry shapes;
`global-stream.ts` defines additive `stream.list.request/response` and
`stream.entry.update.request/response` RPCs. `server_info.features.globalStream` gates global
reads and acknowledged writes; older hosts need updating. The old mutation RPC remains
accepted for old clients. Existing entry kinds/statuses and snapshot fields are unchanged.
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
