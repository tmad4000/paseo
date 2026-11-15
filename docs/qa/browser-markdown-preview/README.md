# Markdown preview verification

Delivery: `feat/markdown-file-preview`, `pspin-8td`. Feature register row: `markdown-preview` in
[the fork feature register](../../fork-features.md).

## Environment

Real Electron desktop dev (`npm run dev --workspace=@getpaseo/desktop`) on `jacob-dev-1` (Linux, X11), built
from this branch with `PASEO_HOME` unset so the dev script used the worktree's `.dev/paseo-home`, a task-owned
daemon, Metro and CDP port, and `CI=1` (inotify limit). The fixture was served by `python3 -m http.server`,
which sends `.md` as `text/markdown` without a charset. Tabs were opened with `paseo ui open-tab --url` and
`--file`; Preview/Source, links and the dark theme were driven over CDP. Screenshots are X11 captures. All
task services were stopped afterwards.

A launch that inherits an agent's `PASEO_HOME=~/.paseo` attaches to that home's running daemon as a client.
Unset it (or set it to the worktree) before `npm run dev` in a worktree.

## Results

| Check                                                  | Result                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `--url http://…/storage-decision.md` (text/markdown)   | Preview by default: front matter table, headings, GFM table, lists, code, links |
| Charset-less UTF-8 (`$1–3`)                            | Preview shows `$1–3`; Source shows Chromium's own `$1â€“3`                      |
| `<script>` and `<img onerror>` in the document         | Shown as text; guest title unchanged; no script elements in the preview         |
| Source toggle                                          | Real guest page shown; Preview restores the rendered document                   |
| Relative link `./other.md`                             | Tab navigates to `/other.md`, which renders                                     |
| HTML page (`/` directory listing)                      | No mode bar; real webview                                                       |
| `--file storage-decision.md`                           | File tab renders formatted by default with Preview/Source                       |
| Dark theme switch while a preview is open; app restart | Preview stays rendered (regression fixed by re-probing once the guest attaches) |

Screenshots: [browser tab, light](01-browser-tab-preview-light.png),
[browser tab, dark after a theme switch](01-browser-tab-preview-dark-after-theme-switch.png),
[code, links and inert HTML](02-preview-code-links-inert-html.png), [Source](03-source-mode.png),
[relative link](04-relative-link.png), [file tab via `--file`, dark](05-file-tab-open-tab-file-dark.png).

Not verified: macOS Electron and the installed Paseo Fork build. GFM task-list checkboxes render as text, as in chat.
