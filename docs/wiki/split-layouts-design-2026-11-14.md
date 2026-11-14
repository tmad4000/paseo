# Paseo fork: tab-local splits ("split this tab") — design decision and spec

Date: 2026-11-14. Author: product/interaction design pass for Jacob's fork `tmad4000/paseo`.
Inputs: research report `paseo-split-layout-research-2026-11-14.md` (same folder); Jacob's
unmerged exploration `origin/design/tab-local-splits-20261029` (README, issue, VALIDATION,
prototype); `docs/cross-project-views.md` (decided 2026-10-02); fork `main` @ `accd8743a`,
read from fork `main` at `accd8743a`.
Read-only: nothing in any repo, agent or daemon was changed.

---

## 1. Decision

**Coexist. No replace. No mode setting.** Add a tab-owned split ("Split this tab") that
lives *inside* a workspace pane's tab, alongside the existing workspace-level pane splits.
Both scopes are explicitly named, both are always available, and they compose: a composite
tab sits in a workspace pane like any other tab and moves with it.

This **confirms the 2026-10-29 recommendation (A + B, not C)** on the product question, and
**changes its implementation direction** in three ways that today's reading of the code
forces:

| Oct 29 said | Today's spec | Why |
| --- | --- | --- |
| "Separate tab-content view tree whose leaves reference view IDs" | A composite tab is a **group of ordinary workspace tabs** plus a tree over their tab IDs. Leaves *are* tabs. | Keeps every upstream walker correct for free: `reconcileWorkspaceTabs`, agent visibility/timeline sync, sidebar counts, deep links, `ui open-tab`, tab picker. A separate leaf tree would make agents in leaves invisible to timeline sync and dead targets linger. Deterministic tab identity stays the single dedup rule. |
| Typed field in the layout, implying a persisted-schema bump | **Sidecar store** (`tab-local-layouts`, own AsyncStorage key, own strict schema). `workspace-layout-state` v2 is untouched. | The v2 schema is `strictObject`; a new field wipes the layout on any older build (TestFlight/Electron beta switching). A sidecar degrades gracefully: an older build simply shows the member tabs as normal tabs. Views used the same pattern (`paseo-views`). |
| "Preserve existing bindings; audit new ones" | Audit done; ⌘\ resolved (section 6). | — |

### Why not replace

The workspace pane tree, its drop zones, maximize, open-beside, Explorer dock and pane
shortcuts are all upstream code under active churn (16 upstream commits to
`workspace-layout-store.ts` since 2026-09-01; upstream's store is now 2470 lines vs the
fork's 1875). FORK.md's rule is explicit: "the fork augments upstream, it never keeps a rival
implementation alive behind a flag." Replacing would also contradict the 2026-10-02 Views
decision (tab-strip-per-pane chosen; one-session-per-pane rejected) and require a lossy
migration of every multi-pane workspace. Replace is ruled out on cost, not taste.

### Why not a setting

Both engines would still be built (cost ≥ coexist), and a hidden default changes what ⌘\
does per install, which hurts help text, voice/agent-driven commands and muscle memory.
Jacob's own exploration said the same. The one legitimate use of a setting, "I personally
want ⌘\ to split inside the tab", is already served by the app's existing shortcut
rebinding (see `keyboard-shortcuts.ts` :94–97, which renders rebound combos), so no new
preference is needed.

### Why coexist is the wise answer, not a hedge

Paseo tabs are agents, terminals, browsers and files. The terminal-emulator model (iTerm,
Ghostty, Warp: tab owns splits) is right for "one task, several surfaces that belong
together": agent + its preview + its shell. The editor model (VS Code, Zed, cmux: pane owns a
tab strip) is right for "a persistent companion that stays while I switch tasks": a Changes
pane, a long-running log. Paseo users do both. Naming the scope in the action ("Split this
tab" vs "Split pane") is what keeps two scopes from being confusing; a mode switch is what
would make them confusing.

---

## 2. Vocabulary (use these words in UI, code and docs)

- **Pane** — upstream's workspace split region; has a tab strip. Unchanged.
- **Tab** — a workspace tab (`WorkspaceTab`, deterministic id). Unchanged.
- **Composite tab** — a tab that owns a tab-local split. Its **host** is the tab whose title
  and strip slot are shown; its **members** are the other tabs grouped under it. Host and
  members are all ordinary tabs in the same pane's `tabIds`.
- **Leaf** — one region inside a composite tab. A leaf shows exactly one member tab (or the
  host). Leaves have a slim header, never a tab strip.
- **Split this tab** (Right / Below) — creates a leaf inside the current tab. Scope word
  "this tab" is mandatory in every label.
- **Split pane** (Right / Down) — upstream's workspace split. Labels unchanged.

---

## 3. Interaction model

### 3.1 Creating a tab-local split

Entry points (Phase 1):

1. **Tab context menu** (right-click a tab in the strip): `Split this tab →` submenu with
   `Right` and `Below`. Placed directly under the existing `Rename` entry, above the
   `Close…` group. Available for any tab except `new_tab` and `setup`.
2. **Command palette**: `Split this tab right`, `Split this tab below`. Also listed in the
   shortcuts help under section `tabs-panes`.
3. **Keyboard**: ⌘⌥\ (right), ⌘⌥⇧\ (below); non-mac Ctrl+Alt+\ and Ctrl+Alt+Shift+\
   (section 6).
4. The "+" pane menu is **not** extended (it already has 4 split entries; the scope of
   "+" is "new tab in this pane").

What happens: the focused tab becomes a composite (if it was not already); its current
content becomes the first leaf; a **chooser leaf** opens on the chosen side, taking 50% of
the leaf that was split (subsequent splits target the *focused leaf*, so T layouts are
possible). Nothing is launched until the user picks.

### 3.2 The chooser (what a new leaf contains)

A split never duplicates a running agent, terminal or browser. The chooser leaf renders a
compact, keyboard-navigable list in the leaf body (same visual language as the empty-pane
"New tab" surface, but narrower and without the launcher's provider grid):

```
Add to this tab
  Existing tab in this pane ›      (submenu / inline list: the pane's other tabs, by icon + title)
  New terminal                      (⌘⇧T hint)
  New agent                         (opens the normal draft composer in the leaf)
  New browser
  ─────────────────────
  Cancel  Esc
```

- **Existing tab** moves that tab into the leaf (it becomes a member and disappears from the
  strip). This is also how a tab is **merged into another tab's split** — there is no second
  action for that.
- **New terminal / New agent / New browser** create a new tab through the existing launcher
  paths (`createNewWorkspaceTab` + the normal draft/terminal/browser creation), then
  immediately group it as a member. The agent draft composer appears in the leaf; the agent
  starts only when the user sends.
- **Esc / Cancel** removes the chooser leaf. If that returns the tab to one leaf, it stops
  being composite. Nothing was created.
- Agents are **never shown twice** in one workspace: if the chosen existing tab already is a
  member elsewhere, the chooser lists it under that composite's name and selecting it moves
  it (break out of the old group, join the new one).

### 3.3 Focus and navigation

- Click anywhere in a leaf focuses it; the leaf header title goes from muted to primary.
- `focusedLeafTabId` is stored per composite. The pane's `focusedTabId` remains the host.
- **⌘⇧←→↑↓ (upstream "Focus pane …") become spatial across both scopes.** The fork's
  handler tries the adjacent leaf inside the current composite first; at the composite's
  edge it falls through to upstream's pane focus. One command, one mental model (tmux/iTerm
  users expect exactly this). No new navigation chords.
- Tab cycling (⌘⇧[ ], Ctrl+Tab), ⌘1–9, Back/Forward, deep links, `ui open-tab`, the tab
  picker and sidebar clicks all go through one rule: **focusing a member means focusing its
  host and setting that member as the focused leaf.** Implemented once as a store
  normalization (section 5.3), so none of those callers change.

### 3.4 Zoom (maximize a leaf)

- ⌘⇧↩ (Ctrl+Shift+Enter) toggles **Zoom leaf**: the focused leaf fills the composite tab;
  siblings are hidden, ratios preserved. Also a header button (`maximize-2` icon) and a
  palette entry `Zoom leaf`.
- Ephemeral (component state, like upstream's pane maximize), not persisted.
- In a non-composite tab the same key falls through to upstream's **Maximize pane**, so the
  key always does the obvious thing.
- While zoomed, the host tab shows the layout glyph with a dotted ring (iTerm's cue) and the
  leaf header shows `Zoomed · ⌘⇧↩`.

### 3.5 Closing

- Leaf header **×** = close that tab via the existing per-target close policy
  (`subagents/close-tab-policy.ts`, dirty-file prompts, terminal consequences). If one leaf
  remains, the tab stops being composite; the strip shows that remaining tab's own title.
- Closing the **host tab from the strip** closes every member through the same per-tab
  policy, in order, atomically at the end. No extra confirmation beyond what the members'
  own policies raise (this matches today's "Close other tabs"). Closing an agent tab never
  archives or kills the agent, exactly as today.
- Upstream's "Close pane" (⌘⇧W) closes the pane including composite tabs; unchanged.

### 3.6 Breaking out and moving

- Leaf header menu (`…`) → **Move to its own tab**: the member leaves the group and
  reappears in the strip immediately to the right of the host. Process untouched.
- Dragging the **host tab** in the strip moves the whole composite (members follow, see
  5.3 co-location). Dropping it on a pane edge creates a workspace pane containing the
  composite. Members are not individually draggable in Phase 1 (they are not in the strip).
- Upstream's ⌘⌥⇧ arrows ("Move tab …") move the host + members as a unit.

### 3.7 Visual distinction of the two scopes

Precise, restrained (Linear/Stripe register), reuses existing tokens:

| Element | Workspace pane | Leaf inside a tab |
| --- | --- | --- |
| Header | Tab strip (existing height, chips) | 24 px header: 14 px target icon · title · spacer · zoom · × · `…`. `theme.colors.textSecondary`; focused leaf title in `theme.colors.text`. |
| Divider | Existing pane gutter + resize handle | 1 px `theme.colors.border` hairline with a 6 px invisible grab area; same cursor as pane handles |
| Focus | Existing pane focus treatment | Header text colour only (no rings around content). Dim-inactive is **not** applied (Views-only today, keep it so). |
| Background | Existing | Same surface as pane content; no inset card |

The rule a user can state in one sentence: **a strip means a pane; a thin title means a
leaf.**

### 3.8 Tab-strip indication

A composite host's chip shows, after its title, a 12 px `columns-2` (top-level horizontal)
or `rows-2` (vertical) glyph and the leaf count: `Build homepage ⧉ 3`. Glyph and count use
the chip's secondary colour; width is reserved via the existing label measurement
(`workspace-desktop-tabs-row.tsx` :552–561). Tooltip: "3 views in this tab: Agent · Preview
· Terminal". Unread/modified badges keep working: the host chip shows the **union** of its
members' unread/modified states (a member agent that needs attention lights the host).
Title stays the host's own title; renaming uses the existing Rename.

### 3.9 Drop zones (Phase 2, specified now so Phase 1 doesn't paint into a corner)

Phase 1 adds **no** new drop zones; all tab-local operations have menu/keyboard paths.

Phase 2: when a tab drag is over a **composite** tab's body, leaf edges become targets
(label on the preview overlay: `Inside "Build homepage"`). Pane edges keep upstream's
preview (label `New pane`). Over a **non-composite** tab's body, leaf-edge targets are only
active while ⌥ is held (label `Inside "<tab>" ⌥`), otherwise upstream's center/edge zones
apply unchanged. One highlighted target at a time; collision detection keeps upstream's
strip > pane order and inserts "leaf edge" between them. If this cannot be made unambiguous
in testing, keep it ⌥-only everywhere.

### 3.10 Mobile / narrow fallback

Splits are web/desktop only (`supportsDesktopPaneSplits()` is `isWeb`). Native and compact
layouts flatten tabs via `collectAllTabs` into `MobileWorkspaceTabSwitcher`. **Phase 1 does
nothing there**: members appear as ordinary tabs in the switcher, which is the correct
degradation and the same thing an older build shows. The group survives in the sidecar for
the return to desktop. Phase 2: indent members under their host in the switcher with a
"in Build homepage" hint.

---

## 4. Data model

```ts
// packages/app/src/tab-local-splits/model.ts  (fork-only module)
export type TabLocalNode =
  | { kind: "leaf"; tabId: string }
  | { kind: "group"; id: string; direction: "horizontal" | "vertical";
      children: TabLocalNode[]; sizes: number[] };

export interface TabLocalLayout {
  hostTabId: string;            // the tab shown in the strip; also a leaf
  root: TabLocalNode;           // every leaf.tabId ∈ {host} ∪ members, each exactly once
  focusedLeafTabId: string;
}

// Persisted (sidecar store `tab-local-layouts`, version 1, strict zod schema):
interface TabLocalSplitsPersistedState {
  layoutsByWorkspace: Record<WorkspaceKey /* `${serverId}:${workspaceId}` */,
                             Record<HostTabId, TabLocalLayout>>;
}
```

Invariants (enforced by `normalizeTabLocalLayouts`, pure, unit-tested):

1. Host and every member are present in **the same pane's `tabIds`** in the workspace layout.
   A member found in another pane is moved back into the host's pane (co-location);
   a member missing from the workspace layout entirely is dropped from the tree.
2. A tree with one leaf is dissolved (the layout entry is deleted).
3. If the host is removed but members remain, the first remaining leaf in document order
   becomes the host.
4. A tab is a member of at most one composite per workspace; it is never both a host and a
   member.
5. Depth ≤ 3 inside a composite (independent of upstream's `MAX_TREE_DEPTH = 5` on the pane
   tree). Leaf minimum 160 × 120 px; "Split this tab" is disabled with a tooltip reason when
   the focused leaf cannot be halved above the minimum.
6. Group `sizes` normalised like upstream (`MIN_SPLIT_SIZE = 0.1`).

**Session identity rule (unchanged, now stated):** one target ⇒ one deterministic tab id ⇒
one tab per workspace. A composite tab groups tabs; it never copies a target. There is no
"duplicate view" of an agent, terminal or browser, in either scope. Two views of a file are
likewise out of scope (files are tabs too).

---

## 5. Persistence, migration, engineering notes

### 5.1 Store

`packages/app/src/stores/tab-local-splits-store.ts`: Zustand + `persist`, name
`tab-local-splits`, version 1, `createValidatedPersistStorage(AsyncStorage, Schema)` exactly
like the layout store. Keys mirror `layoutByWorkspace` keys. Pure operations in
`tab-local-splits/actions.ts`: `splitTabLocal`, `fillChooser`, `closeLeaf`, `breakOutLeaf`,
`focusLeaf`, `resizeTabLocalGroup`, `normalizeTabLocalLayouts`.

### 5.2 No change to `workspace-layout-state`

`WORKSPACE_LAYOUT_PERSIST_VERSION` stays 2; `WorkspaceLayoutStorageSchema` is untouched.
Consequences:

- **Downgrade / older build:** ignores the sidecar key; members render as normal tabs. No
  data loss. The sidecar is re-applied when the new build runs again (invariant 1 re-checks
  co-location).
- **Upgrade:** nothing to migrate; absence of the key = no composites.
- **Future upstream churn** to the layout store does not touch the sidecar; the only
  coupling is the normalization subscription.

### 5.3 Normalization subscription (the one integration point that matters)

A single `useEffect`/store subscription in the fork, mounted with the workspace screen:
on every `workspace-layout-store` change for the focused workspace, run
`normalizeTabLocalLayouts(layout, sidecar)` and (a) write any co-location fixes back via the
existing `moveTabToPaneInLayout`, (b) if `pane.focusedTabId` is a member, set it to the host
and record `focusedLeafTabId = member`. This single rule gives correct behaviour for deep
links, `ui open-tab`, tab cycling, ⌘1–9, Back/Forward, picker and sidebar without touching
those callers.

### 5.4 Upstream touch points (keep each a one-liner)

| Upstream file | Change |
| --- | --- |
| `screens/workspace/workspace-screen.tsx` | Filter member tab ids out of the strip's `tabs` for desktop; pass `tabLocalLayout` for the focused tab to the pane. Mount the normalization hook. |
| `components/split-container.tsx` (`SplitPaneView`) | If the focused tab is a host, render `<TabLocalSplitView>` (fork) instead of the single `WorkspacePaneContent`. |
| `screens/workspace/workspace-desktop-tabs-row.tsx` | Composite glyph + count in the chip label measurement and render; context-menu submenu entries. |
| `keyboard/keyboard-shortcuts.ts` | Add the 3 fork bindings (mac + non-mac). Wrap the 4 focus actions' handlers (fork handler first, fall through). |
| `i18n/resources/en.ts` | New keys under `workspace.tabs.actions.tabLocal.*`; other locales fall back. |
| `docs/fork-features.md` | Register entry with preservation notes. |

Rendering: use `workspace-panel-host.tsx`'s existing per-tab panel cache so leaf content keeps
its instance when the tree restructures (split, close sibling, break out). Verify terminals
re-attach and agent scroll survives; if remounts prove disruptive, Phase 2 flat-renders
leaves (absolute positioning from measured rects) — do not block Phase 1 on it.

Resize: reuse the existing pane resize-handle component with `direction` and write ratios
to the sidecar via `resizeTabLocalGroup`.

### 5.5 Views

Views reuse `SplitContainer`, so composites will *appear* to work there. Phase 1 explicitly
**disables** "Split this tab" in Views (Views tabs carry `scope` and cross-host targets; the
chooser's "Existing tab" semantics need their own pass). Phase 2 enables it.

---

## 6. Keyboard shortcuts and the ⌘\ conflict

Audit of all `combo:` values in `keyboard-shortcuts.ts` at `accd8743a` (section 2 of the
research report lists the pane set; full list grepped today):

| Candidate | Status | Decision |
| --- | --- | --- |
| ⌘\ / ⌘⇧\ | Upstream: Split pane right/down | **Keep upstream's.** Not remapped. |
| ⌘D / ⌘⇧D (iTerm's split) | Upstream: dictation / voice mode | Unavailable. |
| ⌘⌥\ / ⌘⌥⇧\ | Free | **Split this tab right / below.** ⌥ as the "inner variant" modifier of the same key family is a macOS convention and keeps the two scopes on one physical key. |
| Ctrl+Alt+\ / Ctrl+Alt+Shift+\ | Free | Non-mac equivalents (also what Linux web testing uses). |
| ⌘⇧↩ / Ctrl+Shift+Enter | Free (`Enter` alone is bound in the composer) | **Zoom leaf**; falls through to Maximize pane in a non-composite tab. |
| ⌘⌥←→ | Upstream: tab prev/next | Not used for leaf focus; ⌘⇧ arrows go spatial instead (3.3). |
| ⌘⌥⇧ arrows | Upstream: move tab between panes | Unchanged; moves the composite as a unit. |

Resolution of the conflict, stated plainly: **upstream keeps ⌘\; the fork takes ⌘⌥\.** It
preserves upstream help text and the FORK.md rule, costs no muscle memory for existing
users, and any individual who wants iTerm's reflex can rebind ⌘\ → "Split this tab right"
in Settings → Shortcuts (confirm the rebind UI exposes `tabs-panes`; if it does not,
Phase 2 adds a one-click "Swap split shortcuts" there — still not a mode setting, because
it changes only the key, never what the named actions do).

All new bindings use `when: { commandCenter: false }` and **no** `terminal: false`, like the
upstream pane shortcuts, so they fire while a terminal leaf is focused.

---

## 7. Phases

### Phase 1 — ship this (web/desktop only, fork-only feature branch `feat/tab-local-splits`)

1. Sidecar store, schema, pure actions, normalization + co-location + focus redirect, with
   unit tests.
2. Tab context menu `Split this tab → Right / Below`; palette entries; ⌘⌥\, ⌘⌥⇧\ and
   non-mac combos.
3. Chooser leaf: Existing tab in this pane · New terminal · New agent · New browser · Esc.
4. `TabLocalSplitView`: nested resizable layout in the pane body, leaf headers, focus by
   click, zoom (⌘⇧↩ + header button), leaf × (standard close policy), `…` → Move to its own
   tab.
5. ⌘⇧ arrows spatial across leaves then panes.
6. Strip: members hidden; host glyph + count; union unread/modified; tooltip.
7. Composite moves as a unit (strip drag, ⌘⌥⇧ arrows, pane close) via co-location.
8. Views: action disabled with tooltip. Compact/native: no change (flat tabs).
9. `docs/fork-features.md` entry; i18n `en` keys.

Estimated 1.5–2.5k LOC including tests. Upstream-file edits are confined to the six rows in
5.4 and are each small.

### Phase 2 — after Jacob has used it

Drop zones inside composite tabs with `Inside "<tab>"` labels and ⌥-gating (3.9); compact
switcher grouping; open-beside / file opens targeting a leaf; Views support; swap/move leaf by
keyboard (⌘⌥⇧ arrows inside a composite); broadcast "to all agents in this tab";
`ui open-tab … --inside <tab>` and a remote `tab.split`; flat-render for zero remounts;
"Swap split shortcuts" convenience if the rebind UI does not already cover it.

### Explicitly out of scope (both phases)

Duplicate views of one agent/terminal/browser; replacing or hiding workspace pane splits; a
"default split target" preference; any protocol or daemon change.

---

## 8. Acceptance criteria and test plan (Linux web; engineer: Opus)

Environment: fork worktree on a `feat/` branch from the current upstream base, `pnpm`
dev server for `packages/app` web on a random free port 7000–9999, reached over the tailnet
(never report a localhost URL). macOS-only aspects (⌘ bindings, Electron) **cannot be
verified on Linux**; test the Ctrl+Alt variants and leave a note that mac combos were not
exercised here. Use existing test runner conventions in `packages/app` (vitest + RNTL).

Unit (pure functions, `tab-local-splits/*.test.ts`):

- [ ] `splitTabLocal` on a plain tab yields host + chooser leaf, sizes `[0.5, 0.5]`,
      focused leaf = chooser; on a focused leaf inside a composite yields a nested group
      (T layout); refuses at depth 3 and below minimum size with a reason code.
- [ ] `fillChooser(existingTab)` moves the tab in; `fillChooser(newTab)` groups a newly
      created tab; cancel removes the chooser and dissolves a one-leaf composite.
- [ ] `closeLeaf` collapses single-child groups and dissolves at one leaf; closing the host
      promotes the first remaining leaf.
- [ ] `breakOutLeaf` removes the member and reports the strip insertion index (host + 1).
- [ ] `normalizeTabLocalLayouts`: member in another pane → move plan back to host pane;
      member missing from layout → dropped; `focusedTabId` = member → host with that leaf
      focused; a tab referenced by two composites → kept in the first, dropped from the second.
- [ ] Persisted schema: round-trip; unknown key rejected (strict); v2 `workspace-layout-state`
      blob with members present parses unchanged (downgrade simulation).

Component/integration (web):

- [ ] Right-click an agent tab → Split this tab → Right: chooser appears on the right; no
      agent/terminal is created (assert no `agent.create`/terminal create calls).
- [ ] Esc in the chooser: tab returns to a single view, strip chip has no glyph.
- [ ] Choose "Existing tab" (a terminal in the same pane): terminal leaves the strip and
      renders in the leaf; terminal output continues (type in it); chip reads `<title> ⧉ 2`.
- [ ] Choose "New terminal": one new terminal tab is created and appears only as a leaf.
- [ ] Split the terminal leaf below → New browser: three leaves; drag the hairline divider;
      ratios persist across reload (sidecar) while workspace layout blob is byte-identical.
- [ ] Switch to another tab and back: arrangement, focused leaf and the agent's scroll
      position / unsent draft survive.
- [ ] Ctrl+Alt+\ and Ctrl+Alt+Shift+\ perform the two splits from the keyboard with a
      terminal leaf focused (shortcut not swallowed by the terminal).
- [ ] Ctrl+Shift+Enter zooms the focused leaf; again restores ratios; in a non-composite
      tab it triggers upstream's Maximize pane.
- [ ] Focus-direction shortcuts (non-mac equivalents, or dispatch the actions directly in a
      test) walk leaf → leaf → neighbouring workspace pane → back.
- [ ] Deep link / `paseo ui open-tab --agent <member>`: host tab activates with that leaf
      focused; no second tab for the agent appears anywhere in the workspace.
- [ ] Sidebar tab count and unread badge: a member agent producing output lights the host
      chip and the sidebar count includes members.
- [ ] Drag the host chip to a pane edge: a new workspace pane contains the whole composite;
      drag it back onto the original strip: it is one chip again, members intact.
- [ ] Leaf × on a file leaf with unsaved changes raises the existing dirty prompt; on an
      agent leaf closes the tab without archiving the agent (agent still in sidebar).
- [ ] Close the host from the strip: all member tabs are closed with their own policies; no
      agent archived.
- [ ] "Move to its own tab" on a member: chip appears right of the host; content keeps
      running.
- [ ] Views: "Split this tab" entries are disabled with the tooltip.
- [ ] Narrow window (compact breakpoint): switcher lists host and members as flat tabs;
      widen again: composite restored.
- [ ] Existing suites green: `workspace-layout-actions`, `split-container`, identity/dedup,
      sidebar drop, Views keyboard.

Evidence to attach to the PR: unit test output, a short screen recording or screenshots of
the three-leaf layout and the strip chip from the tailnet preview, and the note that
mac-only combos were not run.

---

## 9. Open questions for Jacob

None blocking. One decision is reversible and worth a glance: **⌘\ stays upstream's
workspace split; tab-local split is ⌘⌥\.** If you would rather have iTerm's reflex by
default on your own machine, rebind in Settings → Shortcuts rather than asking the fork to
diverge from upstream's binding.
