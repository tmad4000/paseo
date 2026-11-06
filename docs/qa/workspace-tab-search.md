# Workspace tab search verification

Source: `feat/workspace-tab-search`, 2026-11-05. Design obtained from Astra session
`d92f0e2b-7f3c-4f9c-a2e9-c657ed151dde` before implementation. Not installed or deployed.

## Source checks

- `npm run build:app-deps` — passed.
- `npm run build:server` — passed, including client/protocol declarations and CLI.
- `npm run format` — passed; later edits formatted through `format:files`.
- `npm run lint` — passed, zero warnings/errors.
- `npm run typecheck` — passed across all workspaces after rebuilding declarations and matching
  reused dependencies to this checkout. App typecheck repeated after the final app edits.
- `npm run test --workspace=@getpaseo/app -- --project unit src/workspace-tabs/model.test.ts src/keyboard/keyboard-shortcuts.test.ts src/desktop/browser/shortcuts.test.ts src/command-center/workspace-contributions.test.ts src/components/ui/combobox-keyboard.test.ts src/components/ui/combobox-options.test.ts src/lib/overlay-root.test.tsx --bail=1 --maxWorkers=1`
  — **7 files, 218 tests passed**. No full local test suite ran.

The tests cover every tab kind and saved pane/tab order, hidden Explorer inclusion, unchanged
existing shortcut cases, desktop/browser scope, saved overrides and chord prefixes, Electron guest
shortcut policy, Command Center dispatch, title-versus-context matching, live result identity and
existing overlay focus/composition behavior. They do not establish rendered picker behavior.

## UI boundary

The focused command was:

```sh
m4-workspace run paseo-tab-search -- npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/workspace-tab-search.spec.ts
```

Metro timed out during its first bundle warmup, before UI assertions. The approval gate rejected
execution of the retry. No successful browser screenshots or interaction receipt exist. The test
services were reaped by the workspace runner; the installed daemon was not restarted.

| Surface                                                      | Verified interaction                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| Browser desktop / compact                                    | Pending: spec added, warmup timed out               |
| Electron macOS / Windows / Linux                             | Pending: shortcut forwarding has unit coverage only |
| Native iOS / Android, hardware/software keyboard, large text | Pending                                             |

Run the focused spec, inspect both viewport screenshots, then smoke-test native sheets and installed
Electron before release acceptance. Also exercise a named terminal, browser title, plugin label,
file path, hidden Explorer, duplicate titles, live rename/close and the shortcut from a guest browser
and composer. New search strings currently use English fallback in other locales.

Artifacts from this checkout are retained under `.dev/evidence/workspace-tab-search/`; they are
local verification records, not an installed-build or CI receipt.
