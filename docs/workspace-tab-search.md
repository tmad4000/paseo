# Workspace tab search

**Search workspace tabs** searches the current workspace's existing tabs by their displayed title,
then subtitle and path. Use the search button in the desktop header, the compact active-tab
dropdown, or Command Center. Electron also defaults to Cmd+Shift+O on macOS and Ctrl+Shift+O on
Windows/Linux. Browser web leaves those bookmark/library shortcuts alone. A saved custom binding
that occupies the new default takes precedence; the effective shortcut is shown in help and tooltips.
Cmd/Ctrl+Shift+A remains New agent. Adjacent-tab navigation keeps its focused-pane order.

Results cover the saved pane tree, including the side pane, hidden Explorer and panes covered by
maximization. The traversal deliberately does not use `collectAllPanes`: that helper omits hidden
panes. Empty panes add no results. Saved cross-project Views have their own layout and are outside
this search's scope.

Resolve titles through the panel descriptor path used by the tab strip. Rendering a row with the
real title while filtering a generic fallback label makes named sessions and terminals impossible
to find. Mount descriptors only while the picker is open; do not mount panel content or start
providers to populate search. Filtering stays local. Pane context distinguishes duplicate titles.

Selection reveals the existing tab in its own pane through normal workspace focus. Explorer uses
its existing dock/compact overlay contract for Files, Changes and pull requests. Compact search
presents ordinary content already stored in Explorer through the single-pane renderer, while
keeping the saved main-pane focus and tab placement. Returning to main navigation or leaving compact
presentation clears that transient selection. Covered panes use the shared
[maximized-pane reveal](expo-router.md#maximized-panes). Do not reopen a result after its tab closes.
On web, apply the jump after the picker returns invocation focus, so an old composer's focus handler
cannot pull focus back to the previous pane.

The shared Combobox owns arrows, Enter, Escape, focus trapping and return. Search opts into stable
result identity and search/list accessibility semantics. Live metadata changes retain the highlighted
tab by ID; a changed query chooses a new match. Current-tab selection remains separate from keyboard
highlight. A focused result button owns Enter/Space; arrows from the search field use the list
highlight. Compact touch opens for browsing without forcing the software keyboard.

Source checks cover all tab kinds, hidden-pane inclusion, default/custom shortcut ownership and
Electron guest forwarding. `workspace-tab-search.spec.ts` exercises real title filtering, draft
preservation, keyboard cancellation/selection, empty results and reveal across desktop/compact panes.
See the [verification receipt](qa/workspace-tab-search.md) for passed source checks and the pending
browser, native and installed Electron acceptance work.
