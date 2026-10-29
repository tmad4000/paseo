## Proposal

Support **splitting inside an arbitrary tab**, like a tmux window or iTerm2 tab: one tab owns a nested arrangement of views, and that arrangement disappears/reappears as a unit when switching tabs.

Example: a “Build homepage” tab contains an agent on the left, a preview at top-right and a terminal below it. Switching to “Review changes” shows that tab's own layout. Returning restores the build arrangement.

This is distinct from moving a tab into an existing workspace split. Current `workspace-layout-actions.ts` models workspace split groups whose panes contain tab IDs. The proposal adds tab-owned view layouts, rather than claiming arbitrary content cannot currently be placed in workspace panes.

## Design A — Tab-local split

Add **Split this tab right / below** to tab context menus and a discoverable overflow action. A small layout glyph and count identify composite tabs. Leaf headers show content identity and local actions without another full tab bar. Subsequent splits target the focused leaf.

```text
[ Build homepage ◫ 3 ] [ Review changes ]
┌────────────────────────┬──────────────────────┐
│ Agent                  │ Browser preview      │
│                        ├──────────────────────┤
│                        │ Terminal             │
└────────────────────────┴──────────────────────┘
```

## Design B — Both scopes (recommended with A)

Keep workspace splitting and existing bindings. Expose explicitly named **Split this tab** and **Split workspace** commands. A composite tab can live in a workspace pane and move as a unit.

```text
WORKSPACE PANE 1                         WORKSPACE PANE 2
[ Build ◫ 2 ] [ Review ]                 [ Release checklist ]
┌───────────────────┬─────────────────┐  ┌──────────────────┐
│ Agent             │ Preview         │  │ Persistent      │
│                   │                 │  │ companion view   │
└───────────────────┴─────────────────┘  └──────────────────┘
```

## Design C — Preference alternative

Settings → Layout → **Default split target: Workspace / Current tab**. Only a generic split action follows the preference; explicit commands remain scoped. Existing users retain Workspace by default. Changing the preference never rewrites layouts.

Recommendation: **do not add the setting initially**. Both scopes are useful together; named actions are clearer for discovery, keyboard muscle memory, voice commands and support. Consider a preference later if observed usage warrants it.

## Behavior contract

- Split preserves the source and opens a content chooser. No automatic second agent or terminal launch; explicit choices are existing view, new terminal, new agent, file, browser or supported plugin view.
- Layout operations and duplicate-view operations are separate. Moving existing content never duplicates the process. Unsupported duplicate capabilities explain the limitation.
- Preserve identities, scroll, unsent drafts and terminal/browser/editor state through tab changes and reparenting.
- Close-view operations follow existing target lifecycle safeguards; no implicit agent archive or session termination. Resolve dirty-document/terminal gates before closing a composite tab.
- Collapse single-child groups; support focused-view zoom, layout undo and restore. Do not imply undo can resurrect a terminated process.
- Persist stable view IDs, ratios, focused leaf and target references. Missing targets show recoverable placeholders rather than spawning replacements.
- Compact screens show one focused leaf with a view switcher and retain desktop arrangement. Accessible menus/keyboard commands must cover all drag actions; splitter handles need keyboard adjustment and announcements.
- Preserve existing workspace shortcuts. Audit new shortcuts for conflicts. Enforce a combined nesting/minimum-size budget across scopes.

## Acceptance

- [ ] Split chat, terminal, browser and file views, then split one leaf again.
- [ ] Switch tabs and back; independent arrangements, focus and content state survive.
- [ ] Compose with workspace splits and move a composite tab intact.
- [ ] Cancel chooser, close, undo, zoom, dirty-file and terminal-close cases behave predictably.
- [ ] Restore after restart with missing targets and unavailable plugin surfaces.
- [ ] Complete flows through keyboard, touch, voice-accessible actions and screen reader.
- [ ] Existing split, target identity/deduplication and restoration tests remain green.

Design exploration only; production implementation has not been made. Related existing split regressions worth retaining in validation: #5893 (divider dragging) and #5433 (destination pane).
