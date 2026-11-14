# Split layouts: "split this tab" (iTerm2) and workspace splits (cmux)

**Status (2026-11-14):** Design recommended (Coexist). Phase 1 implementation is next. The code references below are to fork `main` at `accd8743a`.

## The question

In iTerm2, a tab owns its splits: you split the current tab, and the panes hide and come back with that tab. In Paseo today, a workspace owns one split tree and each pane has its own tab strip, like cmux and VS Code. A tab dragged to a pane's edge becomes a new workspace pane, and a tab dropped into a tab strip becomes a sibling tab.

Should Paseo offer the iTerm-style mode, and if so, should it:

1. coexist with the current mode,
2. replace it, or
3. be a setting with defaults?

## History

- **2026-10-02: the Views pane model was decided.** Each pane gets its own tab strip (the cmux / VS Code model). The iTerm model, one session per pane, was rejected. See `docs/cross-project-views.md` and PRs #39 and #41. PR #41 borrowed broadcast input, a split that asks what to open, and dimming of inactive panes from iTerm.
- **2026-10-29: tab-local splits explored (bead `pspin-4ci`, branch `design/tab-local-splits-20261029`, commit `2c7a4fa93`).** This was a recommendation, not a decision:
  - Add an explicitly named **Split this tab → Right/Below** next to **Split workspace**, keep the existing shortcuts, and let the two scopes compose.
  - A tab-local split belongs to its tab and hides and restores as one unit. A workspace split stays visible when you switch tabs.
  - Splitting opens a chooser and never duplicates a running process. Moving content moves it.
  - Implement it as a per-tab content tree under the existing workspace `SplitNode` tree. Existing tabs migrate to a single-leaf tree. Don't overload `parentTabIdByTabId`.
  - A global "Default split target" setting was not recommended at first, because the same shortcut would behave differently on different installs. If one is ever added, it defaults to Workspace.
  - Compact screens show one leaf plus a switcher.
  - Only the prototype logic was validated. The visual review never finished.
- **Merged split work since then:** Split with session (#82), revealing panes hidden behind a maximized pane (#145), split from the + menu (#147, #181), dragging from the sidebar to split (#167), Fork in a split pane (#182).

## How it works today

- **Model:** `SplitPane { id, tabIds[], focusedTabId }`, `SplitGroup { direction, children, sizes }`, and `WorkspaceLayout { root, focusedPaneId }`, all in `packages/app/src/stores/workspace-layout-actions.ts`:15–35. Tabs belong to panes; nothing makes a pane belong to a tab.
- **Tab identity is deterministic per target** (`agent_${agentId}`, `workspace-tabs/identity.ts`:194–203), so a session has exactly one tab per workspace.
- **Drag** (`components/split-container.tsx`:629–695): dropping on a tab strip reorders the tab or moves it into that pane, and a pane left empty collapses. Dropping on a pane's edge creates a workspace split. You always drag a tab; there is no pane object to drag.
- **Maximize** is component state and is not saved.
- **Persistence:** stored per device as `workspace-layout-state` version 2, validated by a strict zod schema (`stores/workspace-layout-storage.ts`:63–115). A new persisted field needs a version bump and a migration, and an older build that reads the new data drops the saved layout.
- **Shortcuts** (upstream, `keyboard/keyboard-shortcuts.ts`:957–1080):

  | Shortcut   | Action      |
  | ---------- | ----------- |
  | ⌘\         | split right |
  | ⌘⇧\        | split down  |
  | ⌘⇧ arrows  | focus pane  |
  | ⌘⌥⇧ arrows | move tab    |
  | ⌘⇧W        | close pane  |

  There is no maximize shortcut.

- **Platforms:** splits exist only on web and Electron (`constants/layout.ts`:50). Compact and native layouts flatten all tabs into a switcher.
- **Ownership:** upstream owns the split model, drop zones, maximize, the Explorer pane and the shortcuts, and changes them often: 16 commits to the layout store since September 2026. FORK.md's "Upstream wins" rule favours fork features that sit on top of upstream's layout over a competing engine.

## Reference products

- **The tab owns the splits:** iTerm2 (⌘D / ⌘⇧D, ⌘⇧↩ to maximize, broadcast to the current tab), tmux (`break-pane` / `join-pane`, zoom), Ghostty, Warp.
- **Each pane has its own tabs:** cmux (workspace → pane → surface), VS Code editor groups, Zed.
- **The pattern:** terminal emulators split inside a tab; editors and agent IDEs give each pane tabs. Paseo is a hybrid, because a tab can be an agent, a terminal, a browser or a file.

Sources:

- https://iterm2.com/documentation-one-page.html
- https://cmux.com/docs/concepts
- https://github.com/manaflow-ai/cmux
- https://gitlab.com/gnachman/iterm2/-/issues/4714 (iTerm's weak break-out-to-tab)

## Options and constraints

| Option                                  | For                                                        | Against                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coexist (the 2026-10-29 recommendation) | Additive and keeps upstream's behaviour. Can be fork-only. | Two split scopes and more drop targets, so the most complicated UI. Every piece of code that walks the tabs has to handle nesting.                    |
| Replace                                 | One iTerm-like model                                       | Rewrites upstream's busiest code, so every sync conflicts. Reverses the 2026-10-02 decision. Migrating existing multi-pane layouts loses information. |
| Setting                                 | Lets Jacob try it, with today's behaviour as the default   | Costs at least as much as Coexist. ⌘\ would mean different things on different installs.                                                              |

What forces the choice:

- upstream owns the outer layout tree;
- the persisted schema is strict;
- each session has one deterministic tab, so someone has to decide whether one agent can appear in two places;
- splits exist only on web;
- ⌘\ is already upstream's binding.

The research estimates Coexist at 2–4k lines with tests.

### Remote control

The CLI and remote UI commands can't operate on panes: there is only `tab.open`/`tab.close`. Any future `ui split` command would need a scope argument if tab-local splits exist.

## Decision

**Recommended 2026-11-14 (Fable design, which confirms the 2026-10-29 direction): Coexist.** Add "Split this tab", but neither replace the current model nor add a mode setting. The full spec is in [split-layouts-design-2026-11-14.md](split-layouts-design-2026-11-14.md).

- **Why not Replace:** FORK.md's "upstream wins" rule, constant upstream churn in the layout code, and the 2026-10-02 Views decision.
- **Why not a setting:** both engines would have to be built anyway, and ⌘\ would mean different things on different installs. Anyone who wants the iTerm habit can rebind it in Settings → Shortcuts.
- **Implementation change since 10-29: leaves are ordinary tabs.** A composite tab is a host tab, its member tabs in the same pane, and a split tree over those members. This keeps one tab per target, which is the dedup rule, so splitting never duplicates an agent, terminal or browser. Every upstream tab walker keeps working unchanged.
- **Persistence:** in a sidecar store, `tab-local-splits` (strict schema, v1). `workspace-layout-state` stays at v2. Older builds ignore the sidecar and show the members as ordinary tabs, so nothing is wiped.
- **Shortcuts:**

  | Shortcut    | Action                                                                         |
  | ----------- | ------------------------------------------------------------------------------ |
  | ⌘\ / ⌘⇧\    | Workspace split, upstream's binding, unchanged                                 |
  | ⌘⌥\ / ⌘⌥⇧\  | Split this tab                                                                 |
  | ⌘⇧↩         | Zoom the leaf; in a tab that isn't split, falls through to maximizing the pane |
  | ⌘⇧ arrows   | Move focus spatially across both levels                                        |

  Ctrl+Alt equivalents are added for Linux and Windows.

- **Phase 1:**
  - Web and desktop only.
  - Split this tab from the tab menu, the command palette and the shortcuts.
  - The new leaf shows a chooser: an existing tab in this pane, a new terminal, a new agent or a new browser.
  - Resizable leaves with thin headers, Zoom, closing a leaf, and "Move to its own tab".
  - A chip in the tab strip showing how many leaves the tab has.
  - A split tab moves as a unit.
  - Disabled in Views. No change on compact or native screens.
- **Phase 2:** inner drop zones (⌥-gated, with labels), grouping in the compact switcher, Views, broadcast to a tab, remote `tab.split`.
