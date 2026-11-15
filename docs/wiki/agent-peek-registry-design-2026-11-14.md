# Paseo fork: agent peek, spawned-agent registry and collapsible panes — design and spec

**Date:** 2026-11-14. **Status:** recommended, not decided. **Topic page:**
[agent-peek-registry.md](agent-peek-registry.md). **Tracking bead:** `pspin-sgu` (`.1` side peek, `.2` registry, `.3` collapsible panes).
Code references are to fork `main` at `b3507d5b5`.

Contents: [1 Recommendation](#1-recommendation) · [2 Asked and proposed](#2-what-was-asked-and-what-is-proposed) ·
[3 The subagent question](#3-are-paseo-spawned-agents-registered-as-subagents) ·
[4 What exists](#4-what-exists-today) · [5 Vocabulary](#5-vocabulary) · [6 Registry](#6-the-registry) ·
[7 Peek](#7-peek) · [8 Chat pane section](#8-the-section-in-the-questions-and-asks-pane) ·
[9 Collapsible panes](#9-collapsible-panes) · [10 State](#10-state-and-persistence) ·
[11 Keyboard and accessibility](#11-keyboard-and-accessibility) · [12 Compatibility](#12-compatibility) ·
[13 Related work](#13-relation-to-work-in-flight) · [14 Phases](#14-phases) ·
[15 Open questions](#15-open-questions-and-defaults) · [16 Sources and limits](#16-sources-and-limits)

## 1. Recommendation

Most of what was asked for is already in the fork, spread over four surfaces that each show a
different slice of the same agents. Build no new surface. Make the existing session side panel
the registry, split its one mixed list into two groups, and point the other surfaces at it.

- **Two groups, never interleaved.** **Spawned agents** are the agents this chat created through
  Paseo. **Provider subagents** are the tasks its provider ran inside its own runtime. The two
  already have separate data sources; only the list merges them.
- **The registry is the Subagents mode of the session side panel.** Rows become cards with
  state, title, provider and model, and last activity. A card expands in place for its latest
  report, task progress and actions. Groups collapse.
- **Peek is the side panel's existing thread view.** Selecting a card shows that agent's full
  chat beside the parent, with its own composer. The parent stays mounted. No new peek
  component.
- **The Questions and asks pane gets one collapsible line.** **Delegated chats** becomes
  **Spawned agents**, lists every spawned agent, starts collapsed, and a row peeks instead of
  opening a tab.
- **Stacked workspace panes collapse to their tab strip.** A separate feature and a separate PR.
  The collapsed strip still shows each tab's running and needs-input marks, so a stack of
  collapsed panes is a second, spatial registry.
- **Phase 1 is client-only.** No protocol, daemon or CLI change. It ships as two PRs: registry
  and peek first, collapsible panes second.

## 2. What was asked, and what is proposed

Jacob asked for three things on 2026-11-14:

1. **Subagent side peek.** From a chat, see the subagents it spawned and open one in a side
   peek without switching windows. Keep provider subagents (Claude Code Task and Agent
   sidechains, Codex sub-tasks) apart from agents he tells a chat to spawn through Paseo. He
   asked whether Paseo-spawned agents get registered as subagents or separately.
2. **A spawned-agent registry for the orchestrator pattern.** A collapsible registry at the side
   of a chat listing the Paseo agents it spawned, with status, model, title and last activity,
   each expandable or openable in place. It could be another expandable section of the floating
   questions and asks pane. Everything collapses. Reference look: Claude's redesigned Projects,
   one main session with a right-hand column of collapsible thread cards. A maximized pane
   gives the registry room without special handling.
3. **Vertically collapsible workspace panes.** Collapse a pane to its header strip so more panes
   stack at the side, for example to drop a freshly spawned agent into a stacked pane.

He said overlap with work in flight is acceptable and to unify where a unification is natural.

Proposed by this spec, not decided by Jacob: the group names; the side panel as the registry's
home; the pane section listing every spawned agent and starting collapsed; creation order for
rows; collapse limited to stacked panes in Phase 1; persistence choices; the shortcut. Section
15 lists them with defaults.

## 3. Are Paseo-spawned agents registered as subagents?

**They are stored separately and shown together.**

|                    | Spawned through Paseo                                                                     | Provider subagent                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Created by         | MCP `create_agent`, or `paseo run` from the agent's shell                                 | The provider, inside the parent's own runtime (Claude Task, Agent and workflows; Codex and OpenCode children) |
| What it is         | A managed agent with its own record, id, title, model, mode, timeline, composer and queue | A descriptor and a read-only timeline. No agent record                                                        |
| Link to the parent | The label `paseo.parent-agent-id`, projected as `parentAgentId`                           | `parentAgentId` on the descriptor, plus `parentSubagentId` for nesting                                        |
| Transport          | The normal agent snapshot and update stream                                               | `agent.provider_subagents.*`, kept in a separate client store                                                 |
| Reply to it        | Yes                                                                                       | No. Steer it through the parent                                                                               |
| Lifecycle          | Archive, detach, cascade with the parent                                                  | None in Paseo                                                                                                 |

Evidence:

- `paseo run` reads `PASEO_AGENT_ID`, checks that the target daemon has that agent, and sends it
  as `callerAgentId` (`packages/cli/src/commands/agent/run.ts:769`). The daemon resolves the
  caller and stamps the parent label (`packages/server/src/server/session.ts:4931`,
  `agent/agent-projections.ts:307`). `paseo inspect` shows the result as `ParentAgentId`. A run
  aimed at another daemon (`--host`, `--home`) has no caller there and creates a root agent.
- Provider subagents never enter `AgentManager`
  ([agent lifecycle](../agent-lifecycle.md#the-subagents-track)). The client selects them from
  `useProviderSubagentStore`, and selects spawned agents from the session store by
  `parentAgentId` (`packages/app/src/subagents/select.ts:70`, `:100`).
- The two selections are then concatenated and sorted by creation time into one list
  (`packages/app/src/subagents/select.ts:166`). The subagents track and the subagents drawer
  both render that list. This is the only place the two kinds meet, and it is why a chat with
  three Paseo workers and twenty Explore tasks reads as twenty-three subagents.
- A provider subagent also shows in the parent's transcript as a `sub_agent` tool call with its
  log and action list (`packages/protocol/src/agent-types.ts:296`). A spawned agent shows there
  only as the `create_agent` or `paseo run` tool call that started it.
- Spawned agents appear a third time, in the Questions and asks pane as **Delegated chats**,
  but only those no ask tracks (`packages/app/src/companion-stream/delegation-pulse.ts:245`).

One wrinkle: OMP child sessions are provider-created but imported as managed agents with a
parent label ([agent lifecycle](../agent-lifecycle.md#provider-managed-child-agents)). They
count as spawned agents here, because they have a record and take replies.

## 4. What exists today

| Surface                                                                              | Shows                                                                                                                                    | Gap against the ask                                                                                                   |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Subagents track** (pill and panel at the foot of the pane)                         | Both kinds, interleaved. A row opens a tab                                                                                               | Not separated. No model or last activity                                                                              |
| **Subagents drawer** (session side panel, Subagents mode, Mod+Shift+J)               | Both kinds, interleaved, with state and a condensed blocker or report. Selecting a row shows its full chat beside the parent, with reply | This is the side peek. Not separated; no model or last activity; a row cannot expand in place; groups do not collapse |
| **Delegated chats** (section of the Questions and asks pane, and of the Stream view) | Spawned agents no ask tracks, with a live state chip. A row opens a tab                                                                  | A partial roster; opens a tab, not a peek; the section does not collapse                                              |
| **Delegation pulse** (chip on a delegated ask)                                       | The child working that ask                                                                                                               | None; keep                                                                                                            |
| **Workspace panes**                                                                  | Split, resize, maximize (not saved)                                                                                                      | No collapse                                                                                                           |

The drawer was built on 2026-10-10 (bead `pspin-c64`) from the same Claude Projects reference
Jacob cited. The missing pieces are separation, card detail, and a way in from the pane he
already watches.

## 5. Vocabulary

**Subagent** stays the umbrella term ([glossary](../glossary.md)). The two kinds get names,
used as group headings and nowhere else:

| Term                            | Meaning                                                          | Notes                                                                                       |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Spawned agents**              | Managed agents whose parent is this chat                         | Not "Paseo agents": the fork's branding rule keeps the product name out of feature copy     |
| **Provider subagents**          | Provider-owned children of this chat                             | "Provider" is already UI copy in Settings                                                   |
| **Peek**                        | Looking at something beside or over the chat without leaving it  | Already the Links track's verb. The same word for agents; a different component (section 7) |
| **Registry**                    | Design-doc word for the Subagents mode of the session side panel | Not UI copy. The panel keeps the title **Subagents**                                        |
| **Collapse pane / Expand pane** | Reduce a workspace pane to its tab strip, and restore it         | Distinct from **Maximize pane** and from minimizing the asks pane                           |

**Delegated chats** is retired in favour of **Spawned agents**. The implementation PR updates
the glossary, the agent lifecycle doc and the companion stream doc in place.

## 6. The registry

### 6.1 Layout

Desktop, side panel open beside the chat:

```
┌ Chat ────────────────────────────┬ Subagents ────────────────────── ✕ ┐
│                                  │ 1 needs input · 2 working · 6 total │
│  transcript                      │                                     │
│                                  │ ▾ SPAWNED AGENTS · 3                │
│                                  │ ┌─────────────────────────────────┐ │
│                                  │ │ ● Opus — registry, Phase 1   4m │ │
│                                  │ │   Needs input · Opus 5.5        │ │
│                                  │ │   Approve: npm run typecheck    │ │
│                                  │ ├─────────────────────────────────┤ │
│                                  │ │ ◐ Tracker — file bead     now ▾ │ │
│                                  │ │   Working · Sonnet 5.5          │ │
│                                  │ │   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │ │
│                                  │ │   Filed the issue and mirrored  │ │
│                                  │ │   it. Waiting on the tracker…   │ │
│                                  │ │   Tasks 3/5 · Mirror to tracker │ │
│                                  │ │   [Peek] [Open in tab]      ⋯   │ │
│                                  │ ├─────────────────────────────────┤ │
│                                  │ │ ○ Review — PR 212           2h  │ │
│                                  │ │   Done · Fable 5                │ │
│                                  │ └─────────────────────────────────┘ │
│  composer                        │ ▸ PROVIDER SUBAGENTS · 3 · 1 working│
└──────────────────────────────────┴─────────────────────────────────────┘
```

Visual rules, from [design.md](../design.md): group headings are small uppercase muted labels
on the panel's left rail; cards are rows separated by hairlines inside one bordered list, not
floating boxes with shadows; one accent, used only for needs-input and for the side that owns
typing; state is always a word beside the dot, never colour alone.

### 6.2 Groups

- **Spawned agents · N** first, then **Provider subagents · N**. A group with no rows is not
  rendered. With one group, its heading still shows, so the kind is always named.
- A heading is a button that collapses its group. Collapsed, it carries the group's summary:
  count, then needs input, failed, working, in that order, zero parts omitted.
- Defaults: Spawned agents expanded. Provider subagents collapsed when the chat has any spawned
  agent, expanded otherwise. An explicit choice wins and is remembered (section 10).
- The header summary line above the groups counts spawned agents only. Provider counts live on
  their own heading. A finished Explore task should not read as something that needs you.
- Nested provider subagents keep today's behaviour: a provider subagent's own children show in
  its pane's track.

### 6.3 A card

Collapsed, a card has up to three lines:

1. State dot, title, last activity as a compact age (`now`, `4m`, `2h`, `3d`), expand chevron.
2. State word, then provider icon and model. For a provider subagent: state word, then the
   provider's own subtitle, shown as given.
3. The condensed blocker or report line the drawer already has. Omitted when there is none.

| Field         | Spawned agent                                                           | Provider subagent                            |
| ------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| Title         | `Agent.title`, else "Untitled subagent"                                 | Task description, else subagent type         |
| State         | Existing drawer buckets: Needs input, Failed, Working, Unread, Done     | running, completed, failed, canceled         |
| Model         | `Agent.model`, falling back to runtime info; hidden when unknown        | Not parsed. The descriptor's `subtitle` only |
| Last activity | `Agent.lastActivityAt`                                                  | Descriptor `updatedAt`                       |
| Activity line | Latest pending permission, else latest outcome, from its Stream entries | None                                         |

Ages tick with the shared live clock. The full local timestamp is on hover and in the
accessible label.

Pressing a card peeks it (section 7). Pressing its chevron expands it in place. The two targets
are separate, and the chevron has its own label.

### 6.4 Expanded in place

Expanding a spawned agent's card shows, without loading its timeline:

- The latest report or blocker in full, up to six lines, then "Show more" into the peek.
- A pending permission's title with **Review**, which peeks the agent at that prompt. Approval
  is never given from the card.
- Task progress from the agent snapshot's `tasks`: done over total, and the in-progress task.
- Mode and working directory or worktree name, muted.
- Actions: **Peek**, **Open in tab**, and an overflow menu with the track's existing **Detach**
  and **Archive**. Phase 2 adds **Open in pane below** (section 9.6).

Expanding a provider subagent's card shows its task description in full, its type, and
**Peek** and **Open in tab**. No lifecycle actions.

Several cards can be expanded at once. Expansion is view state and is not saved (section 10).

Phase 2 replaces the report text with a live tail of the agent's last few timeline items, the
closest match to the Claude Projects thread cards. It waits because it needs each expanded
agent in the viewed-timeline sync, and the cost of that with many cards open should be measured
first.

### 6.5 Order

Creation order inside each group, oldest first, as today. Rows do not reorder by state or
activity, so a row never moves under the pointer. The summary line and the age column carry
urgency and recency.

### 6.6 The track

The track's pill keeps one count. Its panel gets the same two headings, without cards or
expansion. **Read and reply beside this chat** stays as the way into the registry.
**Archive finished** stays at the foot and keeps its current reach.

### 6.7 Narrow and compact

- In a pane narrower than 820px, and on compact layouts, the side panel covers the chat. This
  is existing behaviour. Cards and groups are unchanged; touch targets are at least 44px.
- Hover does not exist on native. The expand chevron and the action row are always visible
  there; nothing appears only on hover.
- The track's panel is a sheet on compact layouts and gets the same two headings.

## 7. Peek

Peek is the side panel's thread view, unchanged in mechanics
([agent lifecycle](../agent-lifecycle.md#the-subagents-drawer)): the selected agent's full pane
beside the parent, **Reply to {subagent}** as its composer placeholder, one composer active at a
time, provider subagents read-only, Back returns to the list, **Open in tab** one press away.

Changes:

- **Every "open this subagent" in the parent's pane peeks first.** The asks pane's Spawned
  agents rows, the delegation pulse chip, and (when it lands) #213's **Open chat** select the
  agent in the registry instead of opening a tab. A tab is still one press away, and
  Mod+click or middle-click on web opens the tab directly.
- **Fallback.** A target that is not a subagent of this chat, lives on another host, or sits in
  a pane too small for the panel keeps today's behaviour: its own tab or session.
- **Previous and Next** in the thread header step within the selected agent's group, then
  continue into the other group.

The Links track's Peek is not reused as a component. It is a scaled page preview in a modal
card; an agent peek is a live pane with a composer and needs the drawer's input ownership. The
two share the verb and the compact behaviour of covering the chat.

## 8. The section in the Questions and asks pane

```
┌ ? Questions and asks        1 new · 2 open            ⤡ ┐
│ QUESTIONS · 1                                           │
│   …                                                     │
│ OPEN ASKS · 2                                           │
│   …                                                     │
│ ▸ SPAWNED AGENTS · 3   1 needs input · 1 working        │
└─────────────────────────────────────────────────────────┘
```

- **Delegated chats · N** becomes **Spawned agents · N** and lists every unarchived spawned
  agent, in the registry's order. Today it lists only those no ask tracks, which makes its count
  disagree with the track's.
- It starts collapsed to its heading and summary. An agent that an ask tracks is therefore not
  shown twice by default: its pulse chip stays on the ask, and the roster costs one line.
- Expanded, each row is one line: state dot, title, state word, age. No cards, no actions. A row
  peeks the agent in the side panel. The "Show N more" cap of five stays.
- A foot row, **Open registry**, opens the side panel on its list.
- Provider subagents are not listed in this pane. It is the surface for asks and answers, and
  provider tasks are the inside of a turn. The registry and the track hold them.
- A spawned agent that newly needs input lights the minimized pill, as a delegated child does
  today. The rule for when the pane appears at all is unchanged.
- The same section replaces Delegated chats above the chat's Stream view, expanded, with its
  hint text.

## 9. Collapsible panes

A workspace pane collapses to its tab strip. This is workspace layout, independent of the
registry, and ships as its own PR.

### 9.1 Behaviour

- **Where.** A pane whose parent split stacks its children top to bottom. Side-by-side panes are
  out of Phase 1: a collapsed column needs a vertical rail with rotated or icon-only tabs, which
  is a separate design.
- **What stays.** The pane's tab strip at its normal height, with every tab's title, running and
  needs-input marks, and unread dot. The body is hidden and stays mounted, the same way a pane
  hidden behind a maximized one does, so scroll position, drafts and live streams survive.
- **Space.** A collapsed pane takes its strip's height and no share of the split. The remaining
  panes divide the rest by their stored sizes, renormalized, the way
  `resolveVisibleGroupFlex` does for hidden panes
  (`packages/app/src/components/split-container.tsx:960`). Stored sizes are not rewritten, so
  expanding restores the height the user dragged to.
- **Floor.** The last expanded pane in a stack cannot be collapsed. Its control is disabled and
  its tooltip says why.
- **Resize.** A divider next to a collapsed pane does not drag.

### 9.2 Controls

- A chevron button in the tab strip's trailing actions, beside Maximize. Tooltip **Collapse
  pane** or **Expand pane** with the shortcut.
- Double-clicking the strip's empty area toggles, on web and desktop.
- The pane menu and the command palette get **Collapse pane** and **Expand pane**.
- Action id `workspace.pane.collapse.toggle`. Proposed shortcut Mod+Alt+Enter, a neighbour of
  Maximize pane's Mod+Shift+Enter. Check it against `keyboard-shortcuts.ts` and the terminal
  pass-through list before binding.

### 9.3 Focus

- Collapsing the focused pane moves focus to the nearest expanded pane in the stack, the one
  above first. Keystrokes never reach a collapsed pane.
- Anything that focuses a tab in a collapsed pane expands it: pressing a tab in its strip,
  directional pane focus, a sidebar row, a deep link, `ui open-tab`. This follows the existing
  rule for a pane hidden behind a maximized one. An expanded pane does not collapse again by
  itself.
- Dropping a tab on a collapsed strip adds it to that pane and leaves the pane collapsed.

### 9.4 With maximize, focus mode and tab-local splits

- Maximizing a collapsed pane shows it full size. Restoring returns it to collapsed. The collapse
  flag is not changed by maximize.
- Focus mode already shows one pane. Collapse has no effect there and its controls are hidden.
- Leaves of a tab-local split (#212) are not panes and do not collapse in Phase 1. A later
  **Collapse leaf** can reuse the presentation helper.
- #209's compact composer applies to short expanded panes. A collapsed pane shows no composer.

### 9.5 Compact layouts

Compact layouts show one pane and have no splits on screen. Collapse is absent there. Saved
collapse state is ignored and kept.

### 9.6 Dropping a spawned agent into a stack (Phase 2)

**Open in pane below** on a registry card opens the agent's tab in a new pane at the bottom of
the nearest stack beside the parent's pane, creating a side stack when there is none, and
leaves it collapsed. The strip shows the new agent's title and state. A per-device setting,
off by default, does this automatically for each newly spawned agent of the focused chat.
`ui.tab.open` gains a matching placement in Phase 3 so an orchestrator can request it.

## 10. State and persistence

| State                         | Scope                                                                | Where                                                                    | Default     |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------- |
| Side panel open, and its mode | Per session, on the host                                             | Existing `paseo.side-panel` label                                        | Closed      |
| Side panel width              | Per device, app-wide                                                 | Existing `paseo:session-side-panel-width`                                | Existing    |
| Selected agent in the peek    | Per pane, in memory                                                  | Existing drawer state                                                    | None        |
| Group collapsed               | Per device, per chat and group                                       | New persisted store `subagent-registry`                                  | Section 6.2 |
| Asks pane section collapsed   | Per device, per pane (the #203 pane key: host, workspace, tab, chat) | Same new store                                                           | Collapsed   |
| Card expanded                 | Per pane, in memory                                                  | Component state, like the asks pane's expanded answers                   | Collapsed   |
| Pane collapsed                | Per device, per workspace                                            | New persisted store `workspace-pane-collapse`: workspace key to pane ids | Expanded    |

- Both new stores are their own storage keys with validated schemas. The pane-collapse store is
  a sidecar and not a field on `SplitPane`, for the reason tab-local splits used one: the
  `workspace-layout-state` schema is strict, and a new field would make an older build drop the
  saved layout. An older build ignores the new key and shows every pane expanded.
- Pane ids that no longer exist are pruned when the layout hydrates.
- The registry store does not live inside the `answers-pane` store, so it merges cleanly whether
  #203 lands before or after.
- Collapse is saved and maximize is not. Maximize is a momentary look at one pane; a collapsed
  stack is a standing arrangement.
- Group and section collapse are per device, like every other preference. They are not labels:
  a second device watching the same orchestrator should not have its groups folded for it.

## 11. Keyboard and accessibility

Keyboard, registry (web and desktop):

| Key          | Action                                                                             |
| ------------ | ---------------------------------------------------------------------------------- |
| Mod+Shift+J  | Existing: open the side panel, move into it, close it                              |
| Up / Down    | Move between group headings and cards, across groups                               |
| Right / Left | Expand or collapse the focused card or group                                       |
| Enter        | Peek the focused card; toggle a focused heading                                    |
| Mod+Enter    | Open the focused card in a tab                                                     |
| Escape       | In the peek, back to the list; in the list, focus returns to the parent's composer |

The list is one tab stop with roving focus. Buttons inside an expanded card are reached with
Tab.

Accessible states:

- Group headings and card chevrons are buttons with `aria-expanded` and a label that carries the
  summary: "Spawned agents, 3, 1 needs input, 1 working".
- A card's label reads title, state, model, last activity, whether it takes replies, then the
  activity line: "Tracker — file bead, working, Sonnet 5.5, active now, can reply, …".
- State is a word and a dot. The needs-input accent is never the only cue.
- Only the header summary is a polite live region. Ages and card bodies are not announced as
  they change.
- The pane collapse control is a button with `aria-expanded` and the pane's focused tab title in
  its label. A collapsed pane's body is removed from the accessibility tree and the tab order.
- A disabled control says why in its tooltip and its accessible hint.
- Focus is never lost: collapsing a group that holds focus moves focus to its heading; a peeked
  agent that is archived or detached returns the panel to the list with focus on the next card.

## 12. Compatibility

- Phase 1 changes no wire schema and adds no RPC. It reads fields the client already receives.
- Provider subagents need a host with `providerSubagents`; without it the group is absent.
- The activity line and the expanded report need `companionStream`; without it a card shows its
  first two lines and expansion shows tasks and actions.
- Task progress needs the agent task snapshot; without it the line is omitted.
- No capability gate is added and no `COMPAT` shim is needed in Phase 1.

## 13. Relation to work in flight

| Work                                                           | Relation                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#213 inline threads** (design)                               | Complementary. Thread rows are the transcript view of agent-to-agent messages; the registry is the roster. Its **Open chat** peeks in this registry. Its thread rows key on recorded sender and recipient and can include agents this chat did not spawn; those are not registry members until Phase 3 |
| **#212 tab-local splits**                                      | Independent. Both add a sidecar layout store, on different keys. Pane collapse touches `split-container.tsx` presentation, which #212 also edits; expect a small merge. Leaves do not collapse in Phase 1                                                                                              |
| **#209 compact composer**                                      | Helps short stacked panes. No dependency                                                                                                                                                                                                                                                               |
| **#203 asks pane state per tab**                               | The section's collapse uses its pane key shape. No dependency on its store                                                                                                                                                                                                                             |
| **Reply threads** ([threaded replies](../threaded-replies.md)) | Their "Not yet" lists threads in the drawer. Phase 3 adds them as a third group, **Threads**, by `paseo.thread-parent`. Lineage and ownership stay separate groups, as `pspin-plx.1` asked                                                                                                             |
| **Links track Peek**                                           | Shares the verb. Not reused as a component (section 7)                                                                                                                                                                                                                                                 |
| **Subagents drawer** (`pspin-c64`)                             | This spec extends it. No behaviour of the thread view, input ownership or labels is removed                                                                                                                                                                                                            |

## 14. Phases

### Phase 1 — client only, two PRs

**PR A: registry and peek.**

1. Stop merging the two kinds: one hook returns both lists; the track panel and the drawer render
   two headed groups.
2. Collapsible groups with the defaults in 6.2 and the `subagent-registry` store.
3. Cards: model, last activity, expand in place with report, tasks and actions (6.3, 6.4).
4. Asks pane and Stream view: **Spawned agents** replaces **Delegated chats**, lists all spawned
   agents, collapses, and rows peek (section 8).
5. Peek-first for the delegation pulse chip, with the fallback in section 7.
6. Keyboard and accessible states (section 11).
7. Docs in place: agent lifecycle, glossary, companion stream, and a fork feature register entry.

Acceptance:

- A chat with two spawned agents and three provider subagents shows two headed groups in the
  track panel and in the registry, with no interleaving, in creation order.
- A spawned agent's card shows its state, model and a ticking age, and expands to its latest
  report, task progress and actions without opening a tab.
- Pressing a card, a Spawned agents row in the asks pane, or a pulse chip shows that agent's chat
  beside the parent with the parent's scroll and draft intact; a reply typed there reaches the
  child only.
- Group and section collapse survive a reload; card expansion does not.
- At 390px the panel covers the chat and every control is visible without hover.
- Against a host without `providerSubagents` or `companionStream`, the registry still lists
  spawned agents.

**PR B: collapsible panes.** Sections 9.1 to 9.5 and the `workspace-pane-collapse` store.

Acceptance:

- In a three-pane stack, collapsing one leaves its strip with live tab marks and gives its
  height to the others; expanding restores the dragged height.
- The last expanded pane cannot be collapsed.
- Focusing a tab in a collapsed pane by click, shortcut or sidebar expands it.
- A draft and scroll position in a collapsed pane survive collapse and expand.
- Collapse survives a reload; an older build reading the same storage shows all panes expanded
  and keeps its layout.
- Maximize and restore return a collapsed pane to collapsed.

Each PR carries focused unit tests on the selectors, reducers and stores, a browser spec on
Linux web, screenshots at 390px and 1440px under `docs/qa/`, and the
[QA evidence](../qa.md) for the platforms it could run on. Linux web results do not verify
macOS, iOS or Android.

### Phase 2 — client only

- **Open in pane below** and the auto-stack setting (9.6).
- Live tail in expanded cards (6.4).
- Collapse for side-by-side panes as a rail, and **Collapse leaf** for tab-local splits, if
  still wanted after Phase 1 use.

### Phase 3 — protocol and daemon

- A **Threads** group for reply threads, and members from #213's exchange log (agents this chat
  messaged and did not spawn) as a fourth group.
- A daemon summary of children for chats whose agents are not loaded on the client, and for MCP
  (`describe_workspace` already lists chats per workspace; extend, do not add a rival).
- A `stack` placement for `ui.tab.open`.
- Cross-host spawned agents, which need an identity that survives the hop.

## 15. Open questions and defaults

Recommendations, each cheap to reverse. None blocks Phase 1.

1. **Group names.** Default: **Spawned agents** and **Provider subagents**. Alternative for the
   second: **Built-in subagents**.
2. **Does the asks pane section list all spawned agents, or only untracked ones?** Default: all,
   collapsed. It makes the count match the registry at the cost of one line.
3. **Should provider subagents appear in the asks pane at all?** Default: no.
4. **Provider group collapsed by default when spawned agents exist?** Default: yes.
5. **Row order.** Default: creation order. Alternative: needs-input first, which moves rows.
6. **Should opening a subagent peek by default everywhere, including the track's rows?** Default:
   the track's rows keep opening tabs, since the track is the tab-opening surface; everything
   else in the pane peeks.
7. **Pane-collapse shortcut.** Default: Mod+Alt+Enter, subject to the clash check.
8. **Do OMP-style imported children belong under Spawned agents?** Default: yes, since they take
   replies. A later label could mark them.
9. **Should collapsing a pane also be reachable by agents (`ui.command`)?** Default: not in
   Phase 1.

## 16. Sources and limits

- Read at `b3507d5b5`: `docs/agent-lifecycle.md`, `docs/companion-stream.md`,
  `docs/chat-links.md`, `docs/threaded-replies.md`, `docs/glossary.md`, `docs/wiki/`,
  `packages/app/src/subagents/`, `packages/app/src/subthreads/`,
  `packages/app/src/companion-stream/answers-pane.tsx` and `delegation-pulse.ts`,
  `packages/app/src/components/split-container.tsx`,
  `packages/app/src/stores/workspace-layout-actions.ts`, `packages/cli/src/commands/agent/run.ts`,
  `packages/server/src/server/session.ts`.
- Read as PR descriptions and branch files, not as merged code: #203, #209, #212, #213.
- Not done: no prototype, no screenshots, no running app. The wireframes are layouts, not
  pixel designs. The installed app was not checked for which of these surfaces it already has.
- The Claude Projects reference is the public announcement linked from the agent lifecycle doc.
  Its layout was taken from Jacob's description.
