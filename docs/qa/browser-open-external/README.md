# Open in browser verification

Delivery: `feat/browser-open-external`, `pspin-18m`. Feature register row: `browser-open-external`
in [the fork feature register](../../fork-features.md).

## Environment

Real Electron desktop dev (`npm run dev --workspace=@getpaseo/desktop`) on `jacob-dev-1` (Linux, X11),
built from this branch with an isolated `PASEO_HOME` under the worktree's `.dev/paseo-home`, and with
task-owned daemon, Metro and CDP ports torn down after the run. The desktop managed its own daemon, so
the main daemon was not touched. Metro ran with `CI=1` because the host's inotify instance limit was
exhausted. A browser tab was opened at `https://example.com/` with
`paseo ui open-tab --url`.

`shell.openExternal` on Linux runs `xdg-open`. The verification run put a recorder script named
`xdg-open` first on `PATH`, so each action logged the URL it would open instead of opening a tab
on the shared desktop.

## Results

| Path                                                     | Result                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Toolbar button (box-with-arrow beside the URL bar)       | `xdg-open https://example.com/`                                            |
| Tab context menu, **Open in browser**                    | `xdg-open https://example.com/`                                            |
| Ctrl+Shift+O with focus in the URL bar                   | `xdg-open https://example.com/`                                            |
| Ctrl+Shift+O with focus inside the page (real X11 input) | `xdg-open https://example.com/`                                            |
| Page right-click menu, **Open Page in Browser**          | Shown first in the native menu (screenshot)                                |
| `about:blank`: toolbar button                            | `aria-disabled="true"`, dimmed                                             |
| `about:blank`: Ctrl+Shift+O                              | Toast "Only http and https pages can open in your browser"; no opener call |

Screenshots: [toolbar tooltip with shortcut](01-toolbar-button-tooltip.png),
[tab context menu](02-tab-context-menu.png), [page context menu](03-page-context-menu.png),
[non-http page disabled state and toast](04-non-http-disabled-toast.png).

## Not covered here

macOS and Windows Electron, plain web and iOS/Android were not run. On those surfaces the
`OpenInBrowserButton` fallback and the tab-menu item go through `openExternalUrl`
(`window.open` on web, `Linking.openURL` on native), which unit tests cover only at the http(s)
policy level. Linux verification does not show macOS behavior.
