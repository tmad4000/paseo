# Discussion log

Newest first. Each entry records the ask, its source, and the outcome, and links to its topic page.

## 2026-11-14: Track the fork in beads and World Issue Tracker

- **Ask:** Jacob asked for the agent-peek / registry / collapsible-panes work to be tracked as a bead first, mirrored on the existing WIT Paseo board, and mirrored on a new WIT board for the fork itself, so WIT can serve as a Linear-like tracker cross-linked to beads and PRs. He also asked which WIT features are missing for that use.
- **Outcome:** Bead epic `pspin-sgu` with children `.1`–`.3` pushed to `refs/dolt/data` and read back from a fresh clone. WIT mirroring is **blocked**: the agent's Ideaflow connection does not have WIT permission granted, and there was no signed-in WIT session to use. The fork board does not exist yet. See [fork-tracking.md](fork-tracking.md).

## 2026-11-14: Subagent side peek, a spawned-agent registry, and collapsible panes

- **Ask:** Jacob asked to see a chat's subagents and open one in a side peek, with provider subagents kept apart from agents spawned through Paseo; for a collapsible registry of spawned agents beside the chat, possibly as a section of the questions and asks pane, in the style of Claude's redesigned Projects; and for workspace panes that collapse to their header strip. He asked whether Paseo-spawned agents are registered as subagents or separately.
- **Source:** Branch `design/agent-peek-registry-20261114`. Bead `pspin-sgu`.
- **Work:** Fable read the subagents track, drawer, asks pane and split layout code and wrote the design ([spec](agent-peek-registry-design-2026-11-14.md)). Opus implements Phase 1.
- **Outcome:** The question is answered: stored separately, shown together. Spawned agents are managed agents with a parent label; provider subagents are read-only descriptors in a separate store; one client selector merges them into a single list. The drawer from 2026-10-10 already is the side peek. The design recommends no new surface: two groups, cards with model and last activity, peek-first opening, a collapsible **Spawned agents** section in the asks pane, and collapsible stacked panes in a sidecar store. A recommendation, not a decision. See [agent-peek-registry.md](agent-peek-registry.md).

## 2026-11-14: Should Paseo offer an iTerm2-style layout, splitting the current tab?

- **Ask:** Jacob asked whether the fork should offer a layout more like iTerm2 than cmux, where you split the current tab instead of a dragged pane becoming a separate tab or workspace pane. Should it coexist with the current mode, replace it, or be a setting with defaults? He remembered asking for an investigation before.
- **Work:** Opus researched the earlier discussions, the current architecture, and iTerm2's and cmux's behaviour. Fable wrote the design ([spec](split-layouts-design-2026-11-14.md)). Opus is implementing Phase 1.
- **Outcome:** The earlier investigation was found: the 2026-10-29 entry below. The design recommends **Coexist, with no setting**. Leaves are ordinary tabs, layouts persist in a sidecar store, and Split this tab is ⌘⌥\. See [split-layouts.md](split-layouts.md#decision). Phase 1 is being implemented on a `feat/` branch.

## 2026-11-13: Native split windows in the right pane over remote control

- **Ask:** Open native split windows in the right pane through remote UI control, rather than opening tabs.
- **Outcome:** Blocked. The remote UI API offers only `tab.open`/`tab.close`. `workspace.pane.split.*` exists only as a client action. This is a gap in remote control, not a question about the layout model; see [split-layouts.md](split-layouts.md#remote-control).

## 2026-10-29: Tab-local splits, explored alongside workspace splits (bead `pspin-4ci`)

- **Source:** Branch `design/tab-local-splits-20261029`, commit `2c7a4fa93` ("docs(pspin-4ci): explore tab-local split layouts and coexistence"). The branch was never merged and has no PR. Its files are under `docs/designs/tab-local-splits/` (README, issue draft, validation note, interactive prototype).
- **Upstream:** getpaseo/paseo#8204 was closed by a bot the same day ("ideas go in Discussions") and was never reposted.
- **Outcome:** A recommendation, not a decision:
  - Add an explicitly named **Split this tab → Right/Below** next to the existing workspace splits.
  - Don't add a "default split target" setting at first.
  - Never duplicate a running process when splitting.

  Details in [split-layouts.md](split-layouts.md#history).

## 2026-10-02: Pane model for cross-project Views

- **Source:** `docs/cross-project-views.md` ("Design decided with Jacob 2026-10-02"), fork PRs #39 and #41.
- **Outcome:** Decided. Each pane in a View gets its own tab strip (the cmux / VS Code model). The iTerm model, one session per pane, was rejected. Replacing workspaces entirely ("full cmux") was rejected because of the merge risk with upstream. PR #41 then borrowed some iTerm pane behaviour: broadcast input, a split that asks what to open, and dimming of inactive panes.
