# Needs you and build status QA

[PR #226](https://github.com/tmad4000/paseo/pull/226). Source: feature branch `feat/needs-you-controls`, based on `146f6e424`.

The screenshots use isolated mock-provider agents and the repository desktop IPC fixture. They contain no live conversations. The baseline captures the original `ForkVersionIndicator` from `146f6e424` in the same fixture; the current source is restored afterward. The after captures include the working-tree permission layout fixes before the final evidence commit.

## Verification

- Seven focused unit files: 290 passed ([raw output](unit.log)).
- Changed card/layout suites after consolidation: 37 passed ([raw output](layout-unit.log)).
- Badge scope and view update regression: five passed ([raw output](badge-unit.log)).
- Six browser/desktop-renderer cases: all passed, one worker ([raw output](ui.log)).
- Independent codex/gpt-6.1-sol review: no remaining blockers ([receipt](review.txt)).
- Fresh build metadata at both widths, then another cached startup at 1280 px: three passed ([first startup](freshness-first.log), [second startup](freshness-second.log)). Both show the actual Git HEAD and the exact harness timestamp. [First metadata](metadata-first.json) and [second metadata](metadata-second.json) have the same commit and different creation times.
- Build-stamp unit suite after the cache fix: four passed ([raw output](stamp-unit.log)).
- Full workspace [typecheck](typecheck.log), [format](format.log) and [lint](lint.log) passed.

Checks ran serially at `nice -n 19`; Vitest and Playwright used one worker. The screenshot runner used one Metro worker, then terminated its own process group and isolated daemons. No shared daemon was restarted.

| Surface                                                   | Coverage                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Browser, Linux Chromium                                   | Reply mode choices, viewed dot clearing and reload persistence, Back, real permission approve/deny API, 390 and 1280 px |
| Desktop renderer, Linux Chromium + repository IPC fixture | Compact tap details at 390 px; hover and click details at 1280 px; relative build age, exact zoned time and commit      |
| Native Electron window                                    | Not manually exercised                                                                                                  |
| macOS, Windows, iOS, Android UI                           | Not manually exercised on this Linux host                                                                               |

## Screenshots

| Width | Before header                    | After header             |
| ----- | -------------------------------- | ------------------------ |
| 390   | [Before](status-before-390.png)  | [After](status-390.png)  |
| 1280  | [Before](status-before-1280.png) | [After](status-1280.png) |

[Version hover](version-hover-1280.png), [390 px reply modes](needs-you-controls-390.png), [1280 px reply modes](needs-you-controls-1280.png), [390 px inline permission](inline-permission-390.png), [1280 px inline permission](inline-permission-1280.png).

The header options considered were `Fork · Current`, an icon-only status, and a combined version/status pill. The chosen layout keeps the version beside one icon + short `Fork · Current` / `Fork · Ready` pill; hover or tap supplies details.
