# Tab-local splits: design exploration

Status: proposal, not implemented. Requested 2026-10-29. Tracking: pspin-4ci; https://github.com/getpaseo/paseo/issues/8204.

## Recommendation

Offer **Split this tab → Right / Below** alongside **Split workspace → Right / Below**. Preserve existing workspace split shortcuts. Do not introduce a global mode switch initially: these are two useful scopes, and users should be able to mix them deliberately.

The key difference is ownership. A workspace split remains visible when a tab changes. A tab-local split belongs to that tab; selecting another tab hides the entire arrangement and returning restores it. Splitting a tab is not duplicating its underlying agent, terminal process, or browser session.

Open `index.html` for three interactive design studies. Study A demonstrates tab switching, nested local splitting, focus, closing a view, reset and undo. Study B shows an existing workspace split surrounding a local tab split. Study C illustrates the optional preference alternative. These are layout prototypes with fixture content, not a live Paseo client. Drag resizing, actual session creation and persistence are specified here but not simulated.

## Evidence and scope

Inspected local fork source: workspace-layout-actions.ts models SplitNode as a pane or group, each pane holds tabIds; workspace-screen.ts handleCreateDraftSplit creates a workspace pane then a draft tab. workspace-layout-store.ts has MAX_TREE_DEPTH=4. Existing workspace support already moves arbitrary tab targets into panes; do not frame this proposal as the first support for arbitrary content in splits. Upstream main was also fetched read-only on 2026-10-29 and confirmed the same pane/group/tabIds ownership model. Local checkout base 85a9f61a0; its product behavior is a design reference, not a claim about every released upstream version. Paseo's public homepage also presents agent, terminal, browser and file surfaces together (https://paseo.sh).

## Three designs

### A — Split inside this tab (recommended primary addition)

Tab context menu and a visible overflow action: **Split this tab right**, **Split this tab below**. The command preserves the current leaf and creates a sibling chooser: existing view, new terminal, new agent, file, browser. Nothing launches until chosen. New views receive focus; Escape cancels the chooser and restores the old arrangement. A small layout glyph and view count on the parent tab communicate ownership. Leaf headers are lightweight and do not repeat full tab strips. Subsequent splits target the focused leaf, allowing T layouts.

Switching tabs restores their independent local arrangements, selection, scroll and drafts. The default parent label stays the original tab title; optional rename is explicit. Closing the original leaf retains the composite tab and its label. Returning to one leaf removes the count/glyph; closing the final leaf follows existing close-tab policy.

### B — Two scopes, composed

Keep workspace pane controls and their existing shortcuts. Put local split commands in the tab context menu/leaf overflow and expose both through the command palette with explicit names. Workspace panes retain independent tab bars. Local layouts travel with their tab when moved between workspace panes. Never infer split scope from a hidden last-used mode.

Drag targets: tab-strip center reorders/moves a whole tab; outer workspace pane edges create workspace splits; leaf edges inside a tab accept views for local splits. Highlight one target only, with text **Inside [tab name]** or **Workspace pane**. Defer drag support if hit zones cannot be unambiguous; every drag operation needs a menu/keyboard equivalent.

### C — Preference-controlled default (alternative, not recommended initially)

Settings → Layout → **Default split target: Workspace / Current tab**. Only an explicitly designated generic split command follows this setting; named scoped commands always do what they say. Existing users default to Workspace. Existing saved layouts do not change when the preference changes. Drawback: identical actions differ across installations and hidden preference state makes help, voice control and muscle memory less predictable. Revisit only if usage shows one scope overwhelmingly dominates.

## Content and lifecycle contract

- Any eligible tab can become a composite: chat, terminal, browser, file/diff, supported plugin view. Unsupported surfaces retain their view and explain why a split or duplicate is unavailable.
- Choose an existing view: move the view; do not clone its process. If it empties a source tab, collapse/remove that empty tab deterministically.
- Duplicate view is separate and capability-gated. Multiple file views share one document/dirty state; independent cursors and scroll. A second agent view must bind to the same agent, never create a second run. Terminal duplication creates a new process only through an explicit **New terminal** action.
- Closing a leaf removes its presentation. Preserve current lifecycle safeguards; dirty-document prompts and any existing terminal-close consequences must be explicit. Do not silently archive agents or kill sessions during layout operations. Closing a composite tab resolves all contained close gates before atomically removing the layout.
- Zoom focused view temporarily; restore prior ratios. Undo layout moves/splits/close-view where underlying targets remain available; never claim undo resurrects killed processes.
- Persist node IDs, ratios, focused leaf and target references, scoped to server/workspace/tab. Missing target becomes a recoverable placeholder. Reopening a saved layout never creates replacement sessions automatically.

## Keyboard, voice and compact screens

Named commands: **Split current tab right/below**, **Split workspace right/below**, **Focus next view**, **Move view to tab**, **Zoom view**, **Close view**. Preserve existing bindings; choose additional bindings only after a collision audit. Focus rings and announced view names identify the target. Splitter handles expose adjustable values and keyboard increments; visible buttons support touch and voice.

Compact widths show one leaf with a view switcher rather than squeezing desktop columns. Preserve the tree and ratios for return to a larger display. Announce parent tab and view index. Enforce measured minimum dimensions and a combined depth/view budget across both scopes; disable unavailable splits with a reason. Prototype uses a four-leaf cap for legibility, not a proposed production limit.

## Implementation direction and acceptance criteria

Introduce a separate tab-content view tree whose leaves reference stable targets/view IDs; do not overload existing parentTabIdByTabId (agent/tab lineage). Keep the workspace SplitNode tree as the outer owner. Existing tabs migrate to a single-leaf content tree with no visual or lifecycle change. Audit deterministic tab identity/deduplication before allowing multiple views of a target. Keep render identity stable during reparenting to protect terminals, editors and browser state.

- [ ] Split an agent, terminal, file and browser tab right/below; cancel chooser without launching anything.
- [ ] Split a leaf again; sibling content and proportions remain stable.
- [ ] Switch tabs and return: each local arrangement, focus, drafts and view state survives.
- [ ] Mix workspace and tab splits; move a composite tab with all contents intact.
- [ ] Close/undo/zoom, dirty files and terminal policy behave as specified; no accidental agent creation or shutdown.
- [ ] Restore layouts after relaunch, missing targets and unavailable plugin surfaces.
- [ ] Complete menu, keyboard and voice workflows without drag; verify screen reader announcements.
- [ ] Compact view preserves layout for desktop; minimum size/depth checks cover both scopes.
- [ ] Existing workspace splitting, shortcuts, target deduplication and restoration regressions pass.
