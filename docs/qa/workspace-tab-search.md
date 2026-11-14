# Workspace tab switcher verification

Delivery: `feat/workspace-tab-search`, `pspin-45p`; design record `pspin-787.7`.
Origin conversation: `a82679b1-b694-44c5-8b11-78724154835e`. Implementation owner:
`e07e83f3-bdfb-4eb1-acea-b12d0d1d1e89`. Fable's reviewed design is evidence; Jacob's
approved corrections use stable strip/layout order, not agent-only MRU.

The original commits through `eec783c4b` remain in history and on
`archive/workspace-tab-search-eec783c4b`. This branch reconciles them with canonical main
`9ae1aafe2f16798ac35dab9176790bc8662601c5`. Current delivery head, Git tree and source-manifest
hash are recorded on the PR and retained cloud job after commit; those records identify the tested
snapshot without embedding a self-referential commit hash in this file.

## Environment and source checks

Validation runs on `jacob-dev-1` as unprivileged `dev`, under
`/home/dev/agent-jobs/paseo-tab-switcher-pspin-45p/`. `owner.txt`, job lock, logs and explicit result
files identify this task. Source and dependencies stay in its `src/`; source transfer excludes Mac
`node_modules`, credentials, environment files and application state. No existing session or service
was restarted. No release, deployment or installed-app update is part of this work.

- Existing lockfile: `npm ci --ignore-scripts --no-audit --no-fund`, followed by the repository's
  `npm run postinstall` and native `npm rebuild node-pty esbuild`. No manifest, lockfile or dependency
  version changed. This is a clean Linux dependency tree, independent of the earlier mixed Mac
  symlinks. The Mac's shared dependencies were not installed into or mutated.
- `npm run build:app-deps` and `npm run build:server`: passed. The initial direct-Node invocation of
  postinstall lacked npm's executable PATH and failed; it was corrected before either build was
  counted. `build.result` now records actual exit zero.
- `npm run format`: passed. Later changed files use `format:files`.
- `npm run lint`: passed with zero warnings/errors after resolving new JSX-prop and nesting findings.
- Final `npm run typecheck`: passed across every workspace, after locale fallbacks and the web
  focus boundary corrections. `final.result` records `state=exited`, `rc=0` for the full final gate.
- Focused source batch: keyboard registry 160, descriptor/search model 3, Electron guest shortcut
  policy 16, Command Center contributions 16, settings storage 82 tests passed. An outdated
  close-on-keyboard-focus expectation failed in the initial batch and was corrected. The follow-up
  passed **5 files / 175 tests**, including shortcut contexts, trailing controls, query handoff state,
  Combobox identity and the A → B → A hook regression. This is not a full local suite.

The legacy hook test logs an IndexedDB-unavailable background attachment-GC warning in JSDOM; its
assertion passes. Real browser lifecycle coverage below is the interaction evidence. The earlier
November 5 mixed-dependency checks are historical only and are superseded by this clean cloud run;
no claim of a pristine historical Mac baseline or historical zero cache writes is made.

## Real browser evidence

The final combined run passed **6/6 flows** against the frozen, formatted source. Command:

```sh
npm run test:e2e --workspace=@getpaseo/app -- \
  e2e/browser/workspace-tab-search.spec.ts e2e/browser/workspace-tab-activity.spec.ts \
  --grep 'workspace title search|compact search presents|keyboard footer|compact titles and read controls' \
  --workers=1
```

Reviewable captures: [wide switcher](workspace-tab-search/switcher-desktop.png),
[compact switcher](workspace-tab-search/switcher-compact.png),
[compact Explorer](workspace-tab-search/compact-explorer-agent.png),
[after A → B → A](workspace-tab-search/compact-explorer-no-resurrection.png),
[desktop handoff](workspace-tab-search/handoff-desktop.png),
[compact handoff](workspace-tab-search/handoff-compact.png),
[normal and long titles](workspace-tab-search/titles-normal-long.png),
[unread active](workspace-tab-search/titles-unread-active.png),
[hover](workspace-tab-search/titles-hovered.png),
[keyboard focus](workspace-tab-search/titles-keyboard-focused.png),
[narrow](workspace-tab-search/titles-narrow.png),
[regular ellipsis](workspace-tab-search/titles-regular-ellipsis.png).

Use the existing app Playwright harness with one worker and task-local `TMPDIR`. It starts its own
mock-provider daemon and Metro, then tears them down; it does not target the installed daemon.
Logs, traces, screenshots and results are retained in the cloud job and this checkout's
`.dev/tab-switcher-20261114/` evidence directory.

The title-density flow passed in real Chromium and its screenshots were inspected by implementation
and origin reviewers. It asserts computed `textOverflow: clip`, a fade only when `scrollWidth` exceeds
`clientWidth`, fitting short/medium titles with no fade, unchanged chip width through unread/hover/
keyboard/read states, a fixed close target after marking read, and regular `ellipsis` after opting
out and reloading. Captures cover normal/long, unread-active, hover, keyboard focus, narrow width and
the setting off. Full accessible names and existing title tooltips are retained.

After the combined run, a stronger check waited for the old picker to unmount before typing. It
exposed compact Escape returning to a disconnected footer. The final fix retains the original
invoking element across the handoff and repeated opens. Focused lint/app typecheck and the strengthened
**2/2 desktop/compact flows passed** after this fix; the refreshed handoff captures show the old
picker fully gone. Origin independently reviewed both the source and the corrected compact capture.
No additional broad retest ran after this focused correction.

Both desktop and compact **keyboard footer handoff** flows passed with matching results present:
native Tab reaches the footer, Enter opens Cmd+K with the typed query, subsequent typing stays in
the global search input, and Escape restores the original invoker. The footer carries the same
native-action marker as result buttons, so Enter cannot activate an unrelated highlighted tab.
It says **Search sessions and workspaces…**; it does not claim Cmd+K indexes every kind of tab.

Picker reveal rechecks cover real title filtering, independently tabbable result activation, Escape
and drafts, empty results, modified text-selection arrows, maximized-pane reveal, compact Explorer
and external main navigation A → B → A. Initial runs exposed test-fixture assumptions: title ranking
put Implementation before Distinctive, and resizing after a localStorage write overwrote the seeded
layout. The tests now use the observed native Tab order and seed before hydration. Keyboard opening
also keeps the composer focused until overlay capture; compact web retains the app's established
policy disabling global shortcuts and uses visible entry points.

## Platform and acceptance boundaries

| Surface                                                    | Evidence / remaining boundary                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Chromium web, wide and compact                             | Real app/daemon flows above; exact final results and snapshot manifest in the PR/job |
| Electron guest forwarding                                  | Unit coverage; installed Electron interaction remains untested                       |
| Native iOS/Android, hardware/software keyboard, large text | Untested; requires device acceptance                                                 |
| Desktop macOS/Windows/Linux packaged app                   | Not installed or restarted in this task                                              |

The browser fixtures use agent tabs for interaction checks. Saved-pane enumeration covers all tab
kinds; titles reuse the existing tab-strip/sidebar descriptor resolver. Native presentation, arbitrary
plugin panels, live non-agent content and packaged Electron require their normal release acceptance.
The feature register remains the release checklist. New labels use the repository's English fallback
in locales without a translation. Merge waits for origin's independent PR review; release/deployment
needs its own authorization.
