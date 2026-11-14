# Workspace tab search

**Switch tab…** finds every open tab in the current workspace across panes, including hidden
Explorer and panes covered by a maximized pane. Use the workspace header button/menu, compact
active-title picker, or Command Center action. The new picker does not widen global Cmd+K's scope.
Its footer, **Search sessions and workspaces…**, passes the query to the existing Command Center;
that surface does not index all terminal, browser, or file tabs.

The default is Cmd+Shift+K on macOS and Ctrl+Shift+K on Windows/Linux desktop. Non-Mac browser web
uses the existing Alt+Shift fallback pattern (Alt+Shift+K), preserving Firefox's console shortcut.
Use Settings → Shortcuts to rebind it. Applicable saved overrides, including chord prefixes, take
precedence over a new default. Keep the original binding IDs so existing search overrides survive.
New-agent and adjacent-tab shortcuts keep their meanings.

Empty query follows saved strip/layout order across all tab kinds. It does not use agent-only
visit history as tab MRU. The current tab stays in that order and is tagged **Current**; its initial
highlight is selection, not a promise of a previous-tab shortcut. Repeating the picker action keeps
the query and highlighted identity. Live metadata updates retain that identity; editing the query
chooses a new match. Pane labels disambiguate duplicate titles without introducing pane tiers.
Saved cross-project Views have their own layout and are outside this workspace picker.

Resolve titles through the same panel descriptor path as the tab strip.
Mount descriptors only while open, never panel content or providers. This keeps live terminal,
browser, plugin and chat titles consistent without starting a session to populate search.

Enter reveals the existing tab in its own pane, using shared maximized-pane reveal. Explorer's
Files/Changes/PR keep their existing overlay contract. Compact ordinary Explorer content uses
transient single-pane presentation without moving the tab or changing saved main focus. Main-pane
navigation permanently invalidates that presentation: A → B → A must not resurrect it. A tab
closed during selection is not reopened. On web, jump after invocation focus has returned so the
previous composer cannot reclaim the old pane. Escape restores the invoker and preserves drafts.
Focused result buttons own Enter/Space; modified input arrows and composition remain text editing.
Compact touch opens for browsing without forcing the software keyboard. Stacked compact Rename/modal
sheets must take web focus ownership above the picker. Gorhom moves their content outside the opener's
context, so nested pickers need their own layer; leaving the old scope on top redirects typing into
the search field.

See the [verification receipt](qa/workspace-tab-search-beta27.md) for source/browser evidence and native
and installed Electron boundaries. Delivery reuses `pspin-45p`; `pspin-787.7` and Fable's review are
design evidence. Tab MRU, Cmd+K redesign and broader scopes remain deferred.

This eligible adaptation preserves a7 plus compact217 and cards218. Move-chat is not introduced; generic nested-modal focus is checked on existing Rename/settings surfaces. Canonical source evidence is separate from derived and installed acceptance.
