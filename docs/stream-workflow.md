# Shared tasks, Q&A and Needs you

Beads pspin-tk3. Jacob authorized implementation on 2026-10-27 through origin
ff9fffdd-6c4f-4d44-b974-36f904a963ae. The priority is **Needs you**, not Tasks.

## Integration audit

- The production task authority is the existing Stream ask. `tasks/FileTaskStore`
  is a standalone Markdown task graph with tests but no production callers; it is
  not the global app task store. This feature does not introduce a second database.
- PR79/c64.1 provides the session side panel. It remains a local projection and can
  host the same Stream view. Provider todo snapshots remain current-turn detail.
- PR121/122/9kx supply explicit/candidate answer revisions and personal seen state.
  These remain on their original entries, independent of execution and intervention.
- 8f5 knowledge/open todos becomes distinct Tasks, Q&A and Saved views alongside
  chronological Activity. Saved uses existing pins/file references, not a new kind.
- PR61/05x source inventory and PR65/one pin curation remain open independent work;
  their unmerged changes and hold/rework requirements are not silently incorporated.
- PR130/pspin-478 explicit chat read is separate. Opening Stream never changes
  question completion, approval or answer seen state; no chat-read policy is changed.
- Release ownership remains 5ffdacd0. No install, restart or release lane is added.

## Identity and storage

A newly written ask gets an immutable UUID `taskId`. Subsequent revisions keep it,
including old clients whose writes omit it. Existing untouched asks project a
stable host/agent/entry identity without a bulk rewrite. Physical storage stays in
its atomic source agent JSON; that storage address is provenance, not an exclusive
execution container. Archived and dormant origins remain readable without loading
providers. Deleting source data is still deleting its records; this is not an archive backup.

`ask.sessions` links exact host/session identities for continuation and delegated
work. All participants read/write the same origin's revision, state, subtasks and
answer. The local view filters origin plus these links; it does not create a task.

For older manually copied asks, `ask.canonicalTask` explicitly names the canonical
host, agent and entry. The copy becomes read-only history in Activity and leaves
current Tasks/Q&A counts. Its original text/state are retained. No fuzzy text match
merges obligations, and no scheduler or agent is launched. An unavailable host is
reported, never taken as proof that its work is complete. Cross-host links are
references, not automatic host-to-host synchronization.

## Intervention is independent

`set_stream_question` accepts `inputRequest` with kind (input, decision, approval,
action), recipient (user, named agent or external party), canonical task reference,
optional subtask and source message. Each input has its own stable question ID and
resolution. Multiple inputs can remain open while task execution continues. A
legacy explicit input remains an input; prose ending in `?` alone is not evidence
of a human obligation. Questions the user asked, unseen results, and finished turns
never become Needs you by themselves. Non-user recipients must be named.

Pending provider permissions also appear in Needs you, but the only action is to
open their authoritative chat controls. A Stream status change cannot approve them.
Expired tool/plan permissions disappear from Needs you; an expired provider question
remains an unresolved input. Reading, dismissing, marking an answer seen or sending
an unrelated reply does not resolve any input or complete any task.

## Views and compatibility

`stream.list.request.view` selects activity/tasks/questions/saved/needs_you.
`relatedServerId` plus `relatedAgentId` selects a local projection across paired
hosts. Workflow views include archived origins by default; the legacy API's default
is unchanged. Search/tag filtering and stable pagination happen on each host before
returning pages. Host notices distinguish disconnected, unsupported and failed reads.
Loaded rows are not a total until pagination is complete, and offline caches are
explicitly stale. New views require `features.streamWorkflow`; existing Activity
continues to work on earlier hosts.

The front end reuses Paseo's sans-serif, foreground/muted hierarchy, neutral surface
scale, subtle borders, spacing tokens, buttons and registered navigation. Needs you
is an always-discoverable shortcut above other views, not a second dashboard. The
composer stays owned by the existing chat/panel layout. New navigation does not
clear drafts or treat focus as completion.
