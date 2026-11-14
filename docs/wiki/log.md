# Discussion log

Newest first. Each entry records the ask, its source, and the outcome, and links to its topic page.

## 2026-11-14: Slack-style inline threads for orchestrator chats, message statuses, reactions

- **Ask:** Jacob asked for the collapsible thread mode he remembered planning for orchestrator sessions, so worker replies stay mostly inline; on by default with a way to turn it off; a status on every message he sends and probably on those received; and Slack-style emoji reactions.
- **Work:** Fable recovered the earlier plans (beads `pspin-plx` and `pspin-plx.1`, PRs #79, #84, #94, #153, #164), inventoried the code, and wrote the design ([spec](inline-threads-design-2026-11-14.md), [prototype](inline-threads/prototype.html)). Nothing was implemented.
- **Outcome:** A recommendation, not a decision. One thread-row primitive, kept in time order, built on the `sender` the daemon already records; statuses extend the existing delivery marks; reactions are annotations that agents never see. Two prerequisites were found: the app drops `sender`, and `paseo send` run by an agent is recorded as `human`. See [inline-threads.md](inline-threads.md#recommendation-2026-11-14).

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
