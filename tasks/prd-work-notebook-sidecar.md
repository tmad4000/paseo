# PRD: Work Notebook Sidecar

## Status

- Product direction: approved for planning
- Implementation status: not started
- Base branch: `chore/sync-upstream-2026-07-24`
- Feature branch: `feat/work-notebook-sidecar`
- Primary user: people running long-lived agent conversations, especially through First Mate

## 1. Introduction

Long agent conversations bury the information that remains useful after the moment it was
discussed. Important links and generated artifacts become difficult to recover. Questions stay
unresolved but disappear into the transcript. Decisions, constraints, and issue status become
scattered across messages and tool output.

Paseo should provide a persistent **Work Notebook** beside every chat. The notebook is a
NoteStream-like record of the work: one canonical chronological stream, with pinned items, open
questions, links, artifacts, decisions, and beads activity presented as projections over that same
stream.

The notebook is not an Artifact Gateway. Artifacts are one event source and one lens within the
notebook. The user-facing job is continuity: make the important state of a long-running
conversation visible and recoverable without rereading the transcript.

Every chat receives a **Session Notebook** by default. A chat may also attach one or more
**Shared Notebooks** used by other chats. Attaching a shared notebook never removes or replaces the
session notebook.

## 2. Product Model

### 2.1 Canonical stream

The stream is the canonical notebook record. Every item captured for the notebook appears in
chronological order:

- chat-turn references;
- user and agent notes;
- opened, resolved, and reopened questions;
- decisions and milestones;
- captured URLs;
- observed artifacts;
- pin and unpin actions;
- notebook attachment and sharing events;
- beads associations and status changes.

Pinned, Open Questions, Links, Artifacts, and Beads are lenses over stream events. They are not
independent copies of the content.

Intentional redundancy is part of the design. An open question remains visible in its original
chronological position and also appears in the Open Questions lens until resolved. A pinned link
continues to appear in the stream while also remaining at the top of the notebook.

### 2.2 Session and shared notebooks

- Each newly created agent chat receives exactly one session notebook.
- The session notebook remains associated with that chat unless explicitly detached during a
  future migration or archival workflow.
- A chat may attach shared notebooks by notebook ID.
- The combined panel may display events from the session notebook and attached shared notebooks.
- Every event retains its origin notebook and author.
- New writes default to the session notebook. The user may explicitly choose a shared notebook as
  the destination.
- Chats are not owned by, or dedicated to, a single beads issue.

### 2.3 Read-only and writable modes

The same data model supports two product experiments:

1. **Derived mode:** Paseo automatically records deterministic events and presents the notebook as
   read-only. Examples include chat-turn references, URLs, artifacts, and beads status changes.
2. **Writable mode:** users and authorized agents can add notes and questions, resolve questions,
   pin items, and choose an event's destination notebook.

These modes must not create separate storage formats. A feature flag or internal preference selects
the available interaction mode while both read from the same event stream.

### 2.4 Model awareness

The full notebook stream must not be injected into every model turn.

The initial model-context experiment provides a compact digest containing:

- active pins;
- unresolved questions;
- recent decisions;
- a small bounded window of recent notebook events.

The digest has a strict token budget and clear provenance. Agents receive explicit notebook tools
for reading and updating notebook state. The default experiment is digest context plus explicit
tools; alternatives are context off and explicit-read-only.

## 3. Terminology

- **Work Notebook:** A persistent event stream and its projections for one body of work.
- **Session Notebook:** The Work Notebook created automatically for one agent chat.
- **Shared Notebook:** A Work Notebook that may be attached to several chats.
- **Notebook panel:** The workspace panel that renders a notebook beside a chat or full-screen on
  compact layouts.
- **Stream event:** An immutable chronological record in a Work Notebook.
- **Lens:** A derived view over stream events, such as Pinned or Open Questions.

Add these terms to `docs/glossary.md` during implementation. Do not use “Artifact Gateway” as a
synonym for Work Notebook.

## 4. Goals

- Keep unresolved questions visible until they are explicitly resolved.
- Let a user recover important links and generated artifacts without searching a long transcript.
- Preserve a chronological, NoteStream-like record of notebook activity.
- Keep pins and open questions consistent with the stream by deriving them from stream events.
- Give every chat a notebook while allowing optional cross-session sharing.
- Reuse Paseo's existing workspace split infrastructure on desktop.
- Support useful read-only and writable experiments on one durable data model.
- Expose relevant beads issue trees without making issue ownership determine notebook ownership.
- Give agents bounded, explicit notebook awareness without injecting unbounded history.

## 5. Non-Goals

- Replacing the chat transcript.
- Duplicating full message bodies into notebook storage.
- Replacing beads or making Paseo a second issue tracker.
- Requiring every chat to correspond to one beads issue.
- Storing the notebook as a directory of Markdown files.
- Reimplementing NoteStream's Yjs, CRDT, PostgreSQL, or offline-sync architecture.
- Automatically sharing private session notebook content with other chats.
- Automatically resolving questions.
- Automatically treating every sentence ending in a question mark as an accepted open question.
- Injecting the complete notebook stream into model context.
- Deleting the existing artifact collector or breaking older clients.
- Defining chat-fork notebook inheritance in the first release. “Fork” here means a forked chat
  branch, not a Git repository fork.

## 6. User Stories

### US-001: See the notebook beside a chat

**Description:** As a user in a long-running chat, I want its notebook visible beside the
conversation so that important context remains in view.

**Acceptance Criteria:**

- [ ] Every agent chat has an Open Notebook action.
- [ ] On desktop, the action opens or focuses the notebook in the pane immediately to the right.
- [ ] If no right pane exists, Paseo creates a right split using the existing workspace layout
      infrastructure.
- [ ] Reopening the notebook focuses the existing notebook tab instead of duplicating it.
- [ ] Chat streaming and composing continue while the notebook is visible.
- [ ] On compact layouts, the notebook opens as a full-screen workspace tab in the center
      destination.
- [ ] Opening the notebook does not add a fourth mobile drawer destination.
- [ ] Split placement and size survive app reload using existing workspace layout persistence.
- [ ] Typecheck and lint pass.
- [ ] Verify the desktop and compact behavior in a real browser.

### US-002: Preserve one canonical stream

**Description:** As a user, I want every notebook item represented in a chronological stream so
that I can reconstruct how the work evolved.

**Acceptance Criteria:**

- [ ] Events receive stable IDs, notebook IDs, sequence numbers, timestamps, authors, and kinds.
- [ ] Events render in deterministic chronological order.
- [ ] Each completed user or assistant turn creates a lightweight turn-reference event without
      copying the full message body.
- [ ] URLs, artifacts, questions, decisions, pins, and beads changes appear as stream events.
- [ ] Stream events retain source references back to the originating chat turn, file, URL, or
      issue.
- [ ] The UI can filter the stream without changing stored order.
- [ ] Reconnect and reload preserve the same event sequence.
- [ ] Protocol and persistence tests cover legacy records without notebooks.

### US-003: Keep questions open until resolved

**Description:** As a user, I want unresolved questions to remain in an Open Questions lens so
that they cannot disappear into a long conversation.

**Acceptance Criteria:**

- [ ] A question-opened event creates an open question.
- [ ] The question appears both in the stream and in Open Questions.
- [ ] Resolving a question appends a resolution event and removes it from the open lens.
- [ ] Reopening appends a reopen event and returns it to the open lens.
- [ ] Resolution never deletes or rewrites the original question event.
- [ ] Each question can link to its source turn.
- [ ] Derived-mode question candidates remain visually distinct until accepted or dismissed.
- [ ] No question is automatically marked resolved by a later message.
- [ ] Verify create, resolve, reload, and reopen behavior in a real browser.

### US-004: Recover links and artifacts

**Description:** As a First Mate user, I want links and generated artifacts surfaced automatically
so that I do not lose them during a long conversation.

**Acceptance Criteria:**

- [ ] URLs in completed turns generate link-captured events with source-turn references.
- [ ] Existing `AgentArtifact` records generate artifact-observed events or deterministic derived
      stream rows without duplicating file bytes.
- [ ] Links and artifacts remain visible in the canonical stream.
- [ ] Dedicated Links and Artifacts lenses can filter the same underlying events.
- [ ] A link opens in the appropriate existing browser behavior.
- [ ] An artifact reuses the existing file-preview and side-file-pane behavior.
- [ ] Repeated observations of an unchanged artifact do not flood the stream.
- [ ] A changed artifact records a new observation while preserving history.
- [ ] Verify link and artifact recovery in a real browser.

### US-005: Pin important items

**Description:** As a user, I want to pin any useful stream item so that it remains visible above
the chronological stream.

**Acceptance Criteria:**

- [ ] Pinning appends a pin event referencing an existing stream item.
- [ ] Unpinning appends an unpin event.
- [ ] Pinned is derived from the latest pin state for each referenced item.
- [ ] Pinned items retain their original stream positions.
- [ ] Pins can include questions, links, artifacts, notes, decisions, and beads references.
- [ ] Pin ordering is stable and user-controlled.
- [ ] Pin state survives reconnect and reload.
- [ ] Verify pin, reorder, unpin, and reload in a real browser.

### US-006: Write notebook entries

**Description:** As a user, I want to add notes and questions directly so that the notebook is more
than an automatically generated report.

**Acceptance Criteria:**

- [ ] Writable mode includes a compact notebook composer.
- [ ] The composer can create a note, question, decision, or milestone.
- [ ] Entry content supports Markdown rendering but is stored as structured event content.
- [ ] The destination defaults to the session notebook.
- [ ] When shared notebooks are attached, the user can explicitly choose another destination.
- [ ] Pending, success, and failure states render in the panel.
- [ ] Failed writes preserve draft content and allow retry.
- [ ] Derived mode hides or disables write actions while preserving the same rendered data.
- [ ] Verify success and visible failure recovery in a real browser.

### US-007: Attach shared notebooks

**Description:** As a user working across related chats, I want to attach a shared notebook without
losing each chat's session-specific notebook.

**Acceptance Criteria:**

- [ ] Creating a chat creates its own session notebook even when shared notebooks exist.
- [ ] Users can attach and detach a shared notebook explicitly.
- [ ] Attached shared events display their notebook origin.
- [ ] Detaching a shared notebook does not delete it or its events.
- [ ] New events default to the session notebook.
- [ ] Shared notebook writes require an explicit destination selection or agent-tool argument.
- [ ] The combined stream has deterministic ordering across notebook origins.
- [ ] Verify two chats viewing one shared notebook while retaining distinct session streams.

### US-008: Inspect the beads issue tree

**Description:** As a user, I want a collapsible view of relevant beads issues so that execution
state is visible without making the chat belong to one issue.

**Acceptance Criteria:**

- [ ] The notebook panel includes a collapsible Beads lens.
- [ ] The lens reads the current workspace's beads issue tree through a read-only adapter.
- [ ] Parent, child, blocker, status, and issue ID are visible.
- [ ] A notebook may associate zero, one, or several focus issue IDs.
- [ ] No issue is treated as the notebook's owner.
- [ ] The tree can show repository-level context even when no focus issue is selected.
- [ ] The first version performs no beads mutations from the notebook.
- [ ] Missing beads, unavailable CLI, and invalid issue IDs render actionable non-blocking states.
- [ ] Verify expanded, collapsed, empty, and unavailable states in a real browser.

### US-009: Give the agent bounded notebook awareness

**Description:** As a user, I want the agent to know important notebook state and update it
explicitly without silently consuming the full stream as model context.

**Acceptance Criteria:**

- [ ] The server can produce a deterministic notebook digest.
- [ ] The digest includes active pins, unresolved questions, recent decisions, and a bounded recent
      event window.
- [ ] The digest enforces a configured token or character budget.
- [ ] Context mode supports `off`, `digest`, and `explicit-only`.
- [ ] The default experiment mode is `digest`.
- [ ] Agent tools can read a digest, append an entry, open a question, resolve/reopen a question,
      and pin/unpin an item.
- [ ] Agent-authored events display agent provenance.
- [ ] Tool writes use revision checks and return conflicts explicitly.
- [ ] Full stream content is available only through an explicit paginated read tool.
- [ ] Tests prove that context size remains bounded as the stream grows.

### US-010: Compare derived and writable value

**Description:** As a product team, we want to compare passive capture with active collaboration so
that the permanent interaction model is evidence-driven.

**Acceptance Criteria:**

- [ ] An internal preference or feature flag selects derived or writable mode.
- [ ] Both modes use the same server data and projections.
- [ ] Instrumentation records notebook opens, link/artifact opens, question accepts, question
      resolves, manual entries, and pins without recording entry contents.
- [ ] The experiment can measure time-to-recover a previously surfaced link or artifact.
- [ ] The experiment can measure unresolved-question return and resolution rates.
- [ ] Switching modes does not migrate or discard data.

## 7. Functional Requirements

- **FR-1:** The daemon must create one session notebook for every newly created agent chat.
- **FR-2:** Existing agent records without a notebook must receive one lazily and idempotently.
- **FR-3:** Notebook content must be daemon-owned; workspace pane placement must remain client-owned.
- **FR-4:** The notebook must use an immutable event stream with monotonic per-notebook sequence
  numbers.
- **FR-5:** Stream writes must support optimistic revision checks.
- **FR-6:** Pinned, Open Questions, Links, Artifacts, Decisions, and Beads must be projections over
  stream events.
- **FR-7:** Every event must identify its origin notebook and author.
- **FR-8:** Every completed chat turn must create a lightweight source-reference event.
- **FR-9:** The system must capture URLs deterministically from completed turns.
- **FR-10:** The existing artifact collector must remain the authoritative source for artifact
  metadata.
- **FR-11:** Artifact bytes must not be copied into notebook storage.
- **FR-12:** The system must deduplicate repeated unchanged link and artifact observations.
- **FR-13:** Users must be able to create notes, questions, decisions, and milestones in writable
  mode.
- **FR-14:** Question state changes and pin state changes must append events rather than mutate
  history.
- **FR-15:** Each chat must keep its session notebook when shared notebooks are attached.
- **FR-16:** Shared notebook attachment and detachment must be explicit and reversible.
- **FR-17:** The combined stream must retain source notebook identity.
- **FR-18:** The Beads lens must be read-only in the initial release.
- **FR-19:** Beads associations may contain several focus issue IDs and must not determine notebook
  ownership.
- **FR-20:** The notebook panel must open through the existing registered workspace-panel system.
- **FR-21:** Desktop side-open behavior must reuse the existing right-neighbor-or-right-split
  placement algorithm.
- **FR-22:** Compact behavior must reuse the center workspace tab and must not modify the
  three-destination mobile panel model.
- **FR-23:** Model context must be bounded and configurable.
- **FR-24:** Agent notebook mutations must occur through explicit typed tools.
- **FR-25:** Derived and writable modes must share storage, protocol, and projection logic.
- **FR-26:** New protocol fields and messages must remain backward compatible.
- **FR-27:** Notebook failures must render pending, success, and actionable failure UI.
- **FR-28:** Notebook event content may contain Markdown but must not be persisted as loose Markdown
  files.
- **FR-29:** The server must paginate stream reads.
- **FR-30:** The client must retain local section-collapse and filter preferences without treating
  them as notebook content.

## 8. Data Model

The exact names may change during implementation, but the semantic contracts must remain.

```ts
interface WorkNotebook {
  id: string;
  scope: "session" | "shared";
  createdAt: string;
  updatedAt: string;
  revision: number;
  lastSequence: number;
}

interface NotebookBinding {
  notebookId: string;
  agentId: string;
  role: "session" | "attached";
  attachedAt: string;
}

interface NotebookEvent {
  id: string;
  notebookId: string;
  sequence: number;
  createdAt: string;
  author: {
    kind: "user" | "agent" | "system";
    id?: string;
  };
  kind:
    | "turn_referenced"
    | "note_added"
    | "decision_recorded"
    | "milestone_recorded"
    | "question_opened"
    | "question_candidate"
    | "question_accepted"
    | "question_dismissed"
    | "question_resolved"
    | "question_reopened"
    | "link_captured"
    | "artifact_observed"
    | "item_pinned"
    | "item_unpinned"
    | "pin_reordered"
    | "beads_focus_added"
    | "beads_focus_removed"
    | "beads_status_observed"
    | "notebook_attached"
    | "notebook_detached";
  markdown?: string;
  targetEventId?: string;
  source?: {
    agentId?: string;
    turnId?: string;
    path?: string;
    url?: string;
    beadsIssueId?: string;
  };
  payload?: Record<string, unknown>;
}
```

The event envelope must use a discriminated union in the actual protocol. `payload` above is
illustrative, not permission to ship an unvalidated bag of values.

## 9. Projection Rules

- **Stream:** all visible events ordered by `(createdAt, notebookId, sequence)`.
- **Pinned:** target items whose latest pin state is pinned, ordered by latest pin-order event.
- **Open Questions:** accepted/opened questions whose latest state is not resolved or dismissed.
- **Links:** latest and historical link-captured events, grouped by normalized URL when useful.
- **Artifacts:** artifact-observed events joined to current `AgentArtifact` metadata.
- **Decisions:** decision-recorded events.
- **Beads:** current read-only issue tree plus focus associations and observed status events.

Projection functions must be pure and testable independently from UI components.

## 10. Design Requirements

Paseo's design character is minimal, spacious, quiet, and confident. The notebook should resemble a
calm working margin, not a dashboard of cards.

- Pinned and Open Questions remain above the scrolling stream.
- Section headers use existing structural-label typography.
- Events use restrained rows with provenance, timestamp, kind, and source affordances.
- The notebook composer is compact and subordinate to the chat composer.
- Section collapse is allowed; Pinned and Open Questions default open.
- The stream supports lightweight lenses or filters without hiding the canonical All view.
- Shared notebook origin is visible but quiet.
- Artifact rendering reuses `ArtifactFeed` internals rather than introducing a second visual system.
- The Beads tree is collapsible and dense enough for hierarchy without dominating the notebook.
- The notebook remains useful at a narrow side-pane width.

## 11. Technical Integration

- Add a notebook target to `WorkspaceTabTarget` in
  `packages/app/src/workspace-tabs/model.ts`.
- Add target normalization, equality, and deterministic IDs in
  `packages/app/src/workspace-tabs/identity.ts`.
- Add and register a notebook panel through
  `packages/app/src/panels/panel-registry.ts` and
  `packages/app/src/panels/register-panels.ts`.
- Reuse `WorkspacePaneContent`, `PaneContext`, `SplitContainer`, retained panels, and
  `workspace-layout-store`.
- Generalize the existing side-file placement helper in
  `packages/app/src/screens/workspace/workspace-pane-state.ts` so it can open any tab target beside
  the source pane.
- Reuse the current side-open orchestration in
  `packages/app/src/screens/workspace/workspace-screen.tsx`.
- Keep the current artifact protocol, collector, and storage intact.
- Add notebook protocol fields as optional and gate editing with a new daemon feature capability.
- Persist notebook metadata, bindings, and paginated event logs under `PASEO_HOME` using atomic
  file operations and the repository's existing file-backed persistence conventions.
- Add a read-only beads adapter at the server boundary. Do not reuse the unrelated Markdown task
  store.
- Update protocol compatibility comments and tests.
- Update `docs/glossary.md`, `docs/data-model.md`, `docs/architecture.md`, and
  `docs/development.md` when implementation begins.

## 12. Compatibility and Migration

- Keep `AgentArtifact` and `artifactFeed` backward compatible.
- A new daemon may expose optional notebook references and capabilities to old clients.
- A new client connected to an old daemon may continue showing the existing Chat/Artifacts switch
  and an update-host message for notebook editing.
- Existing agents receive session notebooks lazily, without rewriting their transcript or artifact
  records.
- Existing artifacts appear through derived notebook rows; migration must not append a large burst
  of historical artifact events.
- Remove the Chat/Artifacts segmented control only after the minimum supported daemon includes the
  notebook panel. Until then, preserve the old surface.

## 13. Experiment Plan

### Experiment A: Derived notebook

Ship the panel with:

- turn references;
- deterministic link capture;
- artifact projection;
- read-only beads tree;
- candidate open questions;
- pins only if they already exist through agent/system events.

Measure:

- notebook open rate;
- link and artifact recovery;
- accepted versus dismissed question candidates;
- return visits to unresolved questions;
- performance on long chats.

### Experiment B: Writable notebook

Enable:

- notebook composer;
- question create/resolve/reopen;
- pin/unpin/reorder;
- decision and milestone entries;
- shared notebook destination selection.

Measure:

- manual entry creation;
- pin use;
- question resolution;
- draft failure and retry;
- session versus shared destination selection.

### Experiment C: Model awareness

Compare:

- context off;
- digest injected automatically;
- explicit tool reads only.

Measure:

- context token overhead;
- correct references to pins and open questions;
- stale-context incidents;
- notebook tool usage;
- agent-created noise versus useful updates.

The experiments may run concurrently for internal users, but each capability must be independently
switchable.

## 14. Delivery Phases

### Phase 1: Durable stream and read-only panel

- Session notebook creation and lazy migration.
- Event storage, pagination, projections, and protocol.
- Registered notebook panel and desktop/compact navigation.
- Turn references, links, artifact projection, and read-only Beads lens.
- Derived-mode question candidates.

### Phase 2: Writable session notebook

- Composer and explicit entry kinds.
- Pin/unpin/reorder.
- Question accept/create/resolve/reopen.
- Pending and failure UI.
- Explicit agent notebook tools without automatic context.

### Phase 3: Shared notebooks

- Shared notebook creation.
- Attach/detach.
- Combined stream and origin labels.
- Explicit write destination.

### Phase 4: Model-context experiment

- Deterministic digest.
- Context modes and token budgets.
- Metrics and internal controls.

### Phase 5: Beads relevance improvements

- Better issue-tree relevance.
- Multiple focus issue associations.
- Status observation events.
- No mutation support until a separate authorization and UX review.

## 15. Testing Strategy

- Protocol tests for old snapshots without notebook fields and new additive fields.
- Pure projection tests for pins, questions, links, combined streams, and shared origins.
- Persistence tests for atomic append, ordering, revision conflicts, pagination, and recovery.
- Workspace-tab identity tests for notebook targets.
- Workspace-pane placement tests for focus-existing-right-pane versus create-right-split.
- Server adapter tests for beads unavailable, empty, tree, and several focus IDs.
- Digest tests proving bounded size as event count grows.
- Targeted Playwright tests for:
  - notebook beside live chat;
  - compact full-screen notebook;
  - link and artifact recovery;
  - question persistence and resolution;
  - writable failure/retry;
  - shared notebook across two chats;
  - derived versus writable mode;
  - beads expanded, collapsed, empty, and unavailable states.

Do not run the repository's full local test suite. Use changed-file tests, targeted Playwright, and
CI as required by `AGENTS.md`.

## 16. Success Metrics

- A previously surfaced link or artifact can be found from the notebook in under ten seconds.
- An unresolved question remains visible after at least 100 subsequent chat messages.
- Resolving a question requires no transcript search.
- Notebook open/focus is one action from a chat.
- Reopening an existing notebook never creates a duplicate panel.
- Derived mode captures at least 95% of deterministic URLs and artifacts without duplicate rows.
- Fewer than 10% of proposed question candidates are dismissed as irrelevant after tuning.
- Digest context remains within its configured budget regardless of stream length.
- Notebook rendering remains responsive with 10,000 events through pagination/virtualization.
- No regression occurs in old-client/new-daemon or new-client/old-daemon protocol parsing.

## 17. Open Questions

These questions do not block Phase 1 unless noted:

- What product-facing term should describe a combined view of the session notebook and attached
  shared notebooks?
- Should a user be allowed to hide turn-reference events from the default All stream?
- Which model, if any, proposes question candidates in derived mode?
- Should accepted question candidates preserve the original candidate event visibly?
- What exact token budget should the default digest use?
- Should shared notebooks support permissions beyond local-host access in the first shared release?
- How should notebook association behave when a chat is forked? Defer until after session notebooks
  ship.
- Should archived chats keep their notebook editable? Default recommendation: readable, with writes
  disabled unless the chat is restored.
- Should a notebook support Markdown export/import? Defer; structured events remain authoritative.

## 18. Product Decisions Made

- The stream contains every captured notebook item.
- Pins and open questions intentionally duplicate visibility while remaining projections.
- Every chat has a session notebook.
- Shared notebooks overlay session notebooks rather than replacing them.
- Chats are not dedicated to one beads issue.
- The Beads lens shows a collapsible tree and may track several focus issues.
- Notebook storage is structured event data, not Markdown files.
- Both derived and writable modes are first-class experiments on one model.
- The agent receives bounded digest context and explicit tools, not automatic full-stream context.
- Artifacts remain supported and become a notebook event source/lens.
- Paseo's existing split infrastructure owns side-by-side presentation.
