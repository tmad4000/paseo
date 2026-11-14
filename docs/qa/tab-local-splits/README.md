# Tab-local splits — Phase 1 QA (Linux web)

Feature: [`tab-local-splits`](../../fork-features.md#tab-local-splits--pspin-4ci).

Environment: Linux host, `packages/app` Metro web dev server, an isolated e2e daemon per
Playwright worker (mock provider, real PTY terminals), Google Chrome 157 with its sandbox on
(`chromiumSandbox: true`, `channel: "chrome"`), 1500×950.

## Browser spec

`npx playwright test e2e/browser/tab-local-splits.spec.ts` walks the checklist in one scenario and
passed on the last three consecutive runs after the final source change (about one minute each):

| Step                                                          | Checked                                                                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Right-click → Split this tab → Right                          | Chooser opens beside the agent; terminal and agent counts unchanged on the daemon                                                               |
| Esc                                                           | Back to one view; no glyph on the chip                                                                                                          |
| Ctrl+Alt+\\ → Existing tab                                    | Terminal leaves the strip, renders in the leaf, `echo` round-trips through the PTY; chip glyph reads 2                                          |
| Ctrl+Alt+Shift+\\ with the terminal focused → New terminal    | Not swallowed by the terminal; one new terminal, shown only as a leaf; chip reads 3; tooltip "3 views in this tab: Agent · Terminal · Terminal" |
| Drag the hairline, reload                                     | Ratios persist in `tab-local-splits`; `workspace-layout-state` byte-identical before and after the drag                                         |
| Switch tab and back                                           | Three leaves, same focused leaf, unsent composer draft kept                                                                                     |
| Ctrl+Shift+Enter twice                                        | Zooms the focused leaf, restores; on a plain tab it toggles Maximize pane                                                                       |
| Focus pane right/left (Cmd+K)                                 | Leaf → leaf → neighbouring pane → back to the same leaf → left leaf                                                                             |
| Deep link `?open=terminal:<member>`                           | Host tab active, that leaf focused, no strip tab for the member                                                                                 |
| Drag host chip to a pane edge, then back onto the other strip | New pane holds the whole composite; back to one chip with three leaves                                                                          |
| Leaf `…` → Move to its own tab                                | Chip appears directly right of the host; terminal still running                                                                                 |
| Leaf × on an agent leaf                                       | Closes that tab through its normal close policy                                                                                                 |
| 600 px wide, then wide again                                  | Compact shows flat tabs; the composite returns                                                                                                  |
| × on the host chip                                            | Members closed through their own policies (terminal confirmation accepted), composite store empty                                               |

Screenshots from a passing run: [chooser](01-chooser-right.png), [three leaves](03-three-leaves.png),
[chip tooltip](04-strip-chip-tooltip.png), [zoomed](06-zoomed.png),
[composite in a new pane](08-composite-in-new-pane.png), [moved to its own tab](09-moved-to-own-tab.png).

## Not exercised here

- Cmd combinations and the Electron desktop app (Linux web only). New browser leaves (Electron only).
- Views (entries are disabled there), the dirty-file prompt on a file leaf, and unread lighting the
  host chip from a member agent's output.
