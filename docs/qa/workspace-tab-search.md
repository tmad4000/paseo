# Workspace tab search verification

Source: `feat/workspace-tab-search`, 2026-11-05. Design obtained from Astra session
`d92f0e2b-7f3c-4f9c-a2e9-c657ed151dde` before implementation. The final design and later four-finding review were also read through
`paseo logs --filter text --tail 3` and the expanded `--tail 10` on continuation. Not installed or deployed.

## Source checks

- `npm run build:app-deps` — passed.
- `npm run build:server` — passed, including client/protocol declarations and CLI.
- `npm run format` — passed; later edits formatted through `format:files`.
- `npm run lint` — passed, zero warnings/errors.
- `npm run typecheck` — passed across all workspaces using rebuilt declarations and the reused
  dependency overlay described below. App typecheck repeated after app edits. This does not
  establish a clean, lockfile-installed baseline.
- `npm run test --workspace=@getpaseo/app -- --project unit src/workspace-tabs/model.test.ts src/workspace-tabs/explorer-sidebar.test.ts src/keyboard/keyboard-shortcuts.test.ts src/desktop/browser/shortcuts.test.ts src/command-center/workspace-contributions.test.ts src/components/ui/combobox.test.tsx src/components/ui/combobox-keyboard.test.ts src/components/ui/combobox-options.test.ts src/lib/overlay-root.test.tsx src/screens/workspace/visible-agent-ids.test.ts --bail=1 --maxWorkers=1`
  — **10 files, 235 tests passed**. No full local test suite ran.

The 235-test batch above covers review commit `256110c2e`. The navigation-return follow-up ran
`search-selection.test.tsx` and `explorer-sidebar.test.ts` with `--bail=1 --maxWorkers=1`:
**2 files, 10 tests passed**. Its hook regression failed before the fix with `explorer` instead of
`main` after returning to the original tab. Targeted lint and app typecheck also passed.

The tests cover every tab kind and saved pane/tab order, hidden Explorer inclusion, unchanged
existing shortcut cases, desktop/browser scope, saved overrides and chord prefixes, Electron guest
shortcut policy, Command Center dispatch, title-versus-context matching, live result identity and
existing overlay focus/composition behavior. The shared Combobox DOM tests exercise focused-result
Enter, modified text-selection arrows and IME Enter in desktop and compact branches. They stub
native animation/sheet presentation and floating geometry; they do not establish browser geometry,
visual quality or native sheet behavior.

## Dependency baseline limitation

No installs or dependency package-content edits were run. Verification reused symlinks into existing
dependency trees rather than a fresh lockfile install. The bounded direct-dependency audit found
these mismatches; it did not audit transitive resolution or establish a pristine baseline:

| Package scope       | Dependency                       | Lockfile | Reused version |
| ------------------- | -------------------------------- | -------- | -------------- |
| App and server      | `markdown-it`                    | 14.3.2   | 10.0.0         |
| App and server      | `@types/markdown-it`             | 14.2.0   | 14.1.2         |
| Protocol and server | `semver`                         | 7.8.5    | 7.7.4          |
| Server              | `@anthropic-ai/claude-agent-sdk` | 0.3.246  | 0.3.220        |
| Server              | `esbuild`                        | 0.25.12  | 0.27.3         |

The passing checks apply to that mixed dependency tree. Initial declaration/dependency failures
were resolved by local builds and links to already installed packages; they were not verified as
feature regressions against a clean baseline. No manifest or lockfile was changed.

The inspected shared caches predated this task, but no pre-run write snapshot exists, so historical
zero writes cannot be certified. Known writable `.vite`/`.cache` links in this worktree's overlay
were replaced with local directories. Follow-up checks use worktree-local temporary and npm cache
paths. The task's known temporary edit script was moved from `/tmp` into local evidence. Further
dependency investigation is deferred per the user's instruction.

## Astra review follow-up

- The navigation-return regression uses the real selection hook: Explorer → another main tab →
  original main tab. It failed before the fix; stale temporary selection is now cleared when its
  presentation becomes invalid, so returning cannot resurrect it.
- Explorer-hosted ordinary tabs now use the compact single-pane presentation without moving the
  tab or changing durable main-pane focus. Timeline visibility follows the presented pane. Actual
  store/model regression tests cover both an agent and a terminal, plus close races.
- Focused result buttons own Enter/Space, instead of activating a different highlighted row. The
  shared Combobox DOM regression covers desktop and compact paths.
- Compact and desktop text-editing modifier guards preserve Shift/Option/Ctrl/Cmd navigation;
  composition Enter remains with the input. DOM tests cover both paths.
- Saved shortcut conflicts are checked against the current platform; non-Mac overrides cannot
  suppress Mac search. Tests also cover saved multi-key chord prefixes and guest forwarding.

## UI boundary

The focused command was:

```sh
m4-workspace run paseo-tab-search -- npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/workspace-tab-search.spec.ts
```

Metro timed out during its first bundle warmup, before UI assertions. The approval gate rejected
execution of the retry. The continuation's one-worker retry was also rejected before execution;
its temporary Metro worker setting was restored with no config diff. No successful browser
screenshots or real-browser interaction receipt exist. The test
services were reaped by the workspace runner; the installed daemon was not restarted.

| Surface                                                      | Verified interaction                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| Browser desktop / compact                                    | Pending: 3-case spec added, warmup timed out; retries rejected |
| Electron macOS / Windows / Linux                             | Pending: shortcut forwarding has unit coverage only            |
| Native iOS / Android, hardware/software keyboard, large text | Pending                                                        |

Browser builds are explicitly deferred while disk/swap is critical. After that constraint clears,
run the focused spec, inspect both viewport screenshots, then smoke-test native sheets and installed
Electron before release acceptance. The spec includes compact Explorer-hosted agent selection and
Tab-to-result activation, separately from arrow highlight. Also exercise a named terminal, browser title, plugin label,
file path, hidden Explorer, duplicate titles, live rename/close and the shortcut from a guest browser
and composer. New search strings currently use English fallback in other locales.

Artifacts from this checkout are retained under `.dev/evidence/workspace-tab-search/`; they are
local verification records, not an installed-build or CI receipt.
