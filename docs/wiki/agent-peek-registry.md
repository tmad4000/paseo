# Agent peek, spawned-agent registry and collapsible panes

**Status (2026-11-14):** Design recommended. Nothing built. Spec:
[agent-peek-registry-design-2026-11-14.md](agent-peek-registry-design-2026-11-14.md). Tracking
bead: `pspin-sgu`. Code references are to fork `main` at `b3507d5b5`.

## The question

Jacob asked for three things for chats that orchestrate other agents:

1. See the subagents a chat spawned and open one in a side peek without switching windows, with
   provider subagents kept apart from agents spawned through Paseo. Are Paseo-spawned agents
   registered as subagents, or separately?
2. A collapsible registry at the side of a chat listing the agents it spawned (status, model,
   title, last activity), each expandable or openable in place, possibly as a section of the
   floating questions and asks pane. Reference: Claude's redesigned Projects.
3. Workspace panes that collapse to their header strip, so more panes stack at the side.

## The answer to the subagent question

Stored separately, shown together. An agent a chat starts through Paseo (`create_agent`, or
`paseo run` from its shell) is a full managed agent stamped with `paseo.parent-agent-id`; the
product calls it a subagent and lists it under its parent. A provider subagent (a Claude Task or
workflow, a Codex or OpenCode child) has no agent record: it arrives as a read-only descriptor
over `agent.provider_subagents.*` and sits in a separate client store. The client then sorts
both into one list by creation time (`packages/app/src/subagents/select.ts:166`), which the
subagents track and drawer render. Separating them is a presentation change.
[Evidence](agent-peek-registry-design-2026-11-14.md#3-are-paseo-spawned-agents-registered-as-subagents).

## History

- **2026-10-10: subagents drawer and session side panel (bead `pspin-c64`).** Built from the same
  Claude Projects reference: a list of a chat's subagents beside it, select one to read and reply.
  [Agent lifecycle](../agent-lifecycle.md#the-subagents-drawer). It lists both kinds in one
  order and has no model, last activity or in-place expansion.
- **Delegation pulse and Delegated chats.** The questions and asks pane shows the child working
  each delegated ask, and lists spawned agents no ask tracks.
  [Companion stream](../companion-stream.md#delegated-asks).
- **2026-11-14: inline threads (PR #213).** Agent-to-agent messages as collapsible rows in the
  transcript. Its **Open chat** uses the drawer. [Inline threads](inline-threads.md), once merged.
- **Pane collapse.** No earlier plan, bead or code was found. Maximize exists and is not saved.

## Recommendation (2026-11-14)

A recommendation, not a decision. Jacob asked for the three things above; the shape is proposed.

- **No new surface.** The session side panel's Subagents mode becomes the registry.
- **Two groups.** **Spawned agents** and **Provider subagents**, each collapsible, never
  interleaved, in the registry and in the track's panel.
- **Cards.** State, title, provider and model, last activity; expand in place for the latest
  report, task progress and actions.
- **Peek is the drawer's thread view.** Opening a subagent from the parent's pane peeks first; a
  tab is one press away.
- **One line in the questions and asks pane.** **Delegated chats** becomes a collapsible
  **Spawned agents** section that lists every spawned agent and peeks.
- **Stacked panes collapse to their tab strip**, saved per device in a sidecar store. Its own PR.

## Phases

| Phase   | What                                                                                                      | Touches               |
| ------- | --------------------------------------------------------------------------------------------------------- | --------------------- |
| 1, PR A | Two groups, cards, peek-first, the asks pane section                                                      | App                   |
| 1, PR B | Collapse and expand stacked workspace panes                                                               | App                   |
| 2       | Open in pane below, auto-stack setting, live tail in cards, rail collapse for side-by-side panes          | App                   |
| 3       | Threads and messaged-agents groups, daemon child summary, `stack` placement for `ui.tab.open`, cross-host | Protocol, daemon, app |

## Open questions

Nine defaults are the spec's recommendations and not Jacob's decisions
([spec section 15](agent-peek-registry-design-2026-11-14.md#15-open-questions-and-defaults)):
the group names, whether the pane section lists all spawned agents, provider subagents staying
out of the asks pane, the provider group's default collapse, row order, which surfaces peek, the
pane-collapse shortcut, where OMP-style imported children sit, and agent control of pane
collapse.
