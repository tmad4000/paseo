# Excluded upstream betas — decision evidence, 2026-11-15

Neither beta is adopted. The GO ceiling is a release published by the end of
2026-10-15 UTC. Publication and annotated-tag targets were independently read from
GitHub's release/ref/tag APIs; JSON receipts are in `/home/dev/code/paseo-maintenance/upstream-go-20261115/`.

| Release                                                                         | Publication UTC     | Annotated tag → commit                                   | 30-day release age reached UTC |
| ------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------- | ------------------------------ |
| [v0.16.0-beta.1](https://github.com/getpaseo/paseo/releases/tag/v0.16.0-beta.1) | 2026-11-10 12:13:20 | `eda7c49b9` → `5196801fdfdad4c954bd37016c57745b07aba430` | 2026-12-10 12:13:20            |
| [v0.16.0-beta.2](https://github.com/getpaseo/paseo/releases/tag/v0.16.0-beta.2) | 2026-11-11 18:33:46 | `b76050438` → `23bae61535542a45ade7196a7b3c152705f16de3` | 2026-12-11 18:33:46            |

Those later dates are necessary age checks, not automatic adoption permission:
the release ceiling and every newly introduced dependency still need review.
The stable-after-24-hours Codex/Claude exception does not apply to Paseo.

## What the beta series offers

The publisher's release notes describe cumulative series changes. Their presence
in the notes does not prove the fork lacks them: PR193 already selectively carries
some newer provider fixes. Compare each behavior with the fork before a future
integration.

| Area                     | Publisher change and primary reference                                                                                                                                                                                                                                                                                                                                | Fork overlap and integration concern                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent work               | Background shell/monitor tasks with Stop for Claude, Codex and OpenCode v2: [#6220](https://github.com/getpaseo/paseo/pull/6220), [#9162](https://github.com/getpaseo/paseo/pull/9162). Background agents: [#8683](https://github.com/getpaseo/paseo/pull/8683).                                                                                                      | Shares composer/agent lifecycle surfaces with subagents drawers and Stream delegation pulse. Preserve child ownership, queue admission and notifications; do not treat shell tasks as completed child conversations.       |
| Plugins                  | Replaceable multi-host sidebar views [#8906](https://github.com/getpaseo/paseo/pull/8906); composer controls/metadata/focus [#8744](https://github.com/getpaseo/paseo/pull/8744), [#9209](https://github.com/getpaseo/paseo/pull/9209), [#9207](https://github.com/getpaseo/paseo/pull/9207).                                                                         | Direct overlap with fork Stream/Views, Quick launch, sidebar filter/grouping/pins, queues and composer ownership. A plugin view must not silently retire these fork surfaces.                                              |
| Timeline                 | Rebuilt native timeline [#8717](https://github.com/getpaseo/paseo/pull/8717), [#9085](https://github.com/getpaseo/paseo/pull/9085); stable end-of-turn and cached return [#8944](https://github.com/getpaseo/paseo/pull/8944), [#9175](https://github.com/getpaseo/paseo/pull/9175).                                                                                  | Conflicts likely in reading-position, virtualized turns, threaded replies, message pins/answers and compact retained panels. Source overlap is identified; no beta conflict-resolution or native acceptance claim is made. |
| Compact/tablet           | Physical keyboard shortcuts [#8625](https://github.com/getpaseo/paseo/pull/8625); touch controls and sidebar swipe [#8748](https://github.com/getpaseo/paseo/pull/8748), [#8909](https://github.com/getpaseo/paseo/pull/8909); panel-width-aware controls [#8740](https://github.com/getpaseo/paseo/pull/8740), [#9088](https://github.com/getpaseo/paseo/pull/9088). | Preserve fork panel placement, local splits, maximized-pane reveal, keyboard dismiss and tab shortcuts. Linux cannot establish iOS/macOS acceptance.                                                                       |
| Questions and workspaces | Explicit Next/Submit in question cards [#8525](https://github.com/getpaseo/paseo/pull/8525); archive Undo [#8904](https://github.com/getpaseo/paseo/pull/8904), [#9104](https://github.com/getpaseo/paseo/pull/9104); last focused tab restore [#8935](https://github.com/getpaseo/paseo/pull/8935).                                                                  | Check provider question state separately from durable Stream asks/answers. Preserve focus history, manual status, queued work and explicit unread/read clocks.                                                             |
| Changes and connections  | Batched/prioritized diffs [#8907](https://github.com/getpaseo/paseo/pull/8907), [#9241](https://github.com/getpaseo/paseo/pull/9241), [#9243](https://github.com/getpaseo/paseo/pull/9243); fewer reconnects [#8651](https://github.com/getpaseo/paseo/pull/8651), [#9086](https://github.com/getpaseo/paseo/pull/9086).                                              | Preserve fork relay pagination, host selection, disconnected drafts, diagnostics and delivery marks.                                                                                                                       |
| Providers                | Claude plan mode/effort/history/recovery; Codex approval diffs and concurrent SQLite initialization; OpenCode restart/permission handling; Pi archived/compacted history; ACP permission/mode/model failures. See the detailed [beta.1 notes](https://github.com/getpaseo/paseo/releases/tag/v0.16.0-beta.1).                                                         | Some code was already selected by PR193. A future exception must preserve newer fork runtime catalogs, exact pending-permission identity, queue semantics and process environment/account attribution.                     |
| Browser tools            | React-controlled input fill [#9022](https://github.com/getpaseo/paseo/pull/9022), CSP-safe evaluate [#8973](https://github.com/getpaseo/paseo/pull/8973), HTTP status in logs [#8956](https://github.com/getpaseo/paseo/pull/8956).                                                                                                                                   | Overlaps the fork browser pane, automation registry, browser links and the in-flight Markdown preview work. Needs real Electron/browser tests without weakening the sandbox.                                               |

## What beta.2 adds after beta.1

The exact [beta.1 → beta.2 comparison](https://github.com/getpaseo/paseo/compare/v0.16.0-beta.1...v0.16.0-beta.2)
contains 22 commits, including release reconciliation, documentation and tests.
The behavior changes include:

- Codex reconnect/warning visibility without false recovery on child completion,
  `aade09d05`, [#9370](https://github.com/getpaseo/paseo/pull/9370), 2026-11-11 10:10:32 UTC.
- Resumed Pi subagent runs/transcripts, `a4878656e`,
  [#9261](https://github.com/getpaseo/paseo/pull/9261), 2026-11-11 12:01:35 UTC.
- ACP prompt-response token usage, `18c002cbf`,
  [#9396](https://github.com/getpaseo/paseo/pull/9396), 2026-11-11 14:06:49 UTC.
- Plugin background-work counts/hooks, `a886bfbc`,
  [#9362](https://github.com/getpaseo/paseo/pull/9362), 2026-11-11 08:10:13 UTC;
  terminated-plugin removal `ee6a2bba7`, [#9285](https://github.com/getpaseo/paseo/pull/9285),
  2026-11-11 05:53:39 UTC.
- Restore archived workspace agents, inline sidebar rename, collapsed-first-frame
  long prompts and nested-button fixes. These intersect fork archive semantics,
  long-prompt preview and sidebar actions; their tests are not fork parity proof.

The task-owned `beta2-commits.tsv` receipt records every exact SHA, UTC committer date and subject.
The [v0.15.4 → beta.1 comparison](https://github.com/getpaseo/paseo/compare/v0.15.4...v0.16.0-beta.1)
contains 205 commits across the upstream release histories. This is not the same
measurement as commits after PR193's selectively synced main commit; do not label
all 205 newly missing fork behaviors.

## Dependency and conflict implications

Comparing the frozen beta.2 lock to fork base `5280b0dd` finds 551 added/changed
external package-path/version records and 309 removed records. Hoisting changes
contribute to these counts; they are not counts of unique new dependencies.
Examples: Expo `54.0.33 → 57.0.30`, React Native `0.81.5 → 0.86.3`,
Reanimated `4.3.1 → 4.5.5`, expo-modules-core `3.0.29 → 57.0.23`,
electron-builder `26.8.1 → 26.18.0`, and @electron/rebuild `4.0.3 → 4.2.1`.
The compared Claude Agent SDK (`0.3.246`) and OpenCode SDK (`1.14.46`) are unchanged.

Representative version publication times were independently read from the npm registry:

| Package/version                                                                     | Published UTC            | One-month gate at execution           |
| ----------------------------------------------------------------------------------- | ------------------------ | ------------------------------------- |
| [expo 57.0.30](https://registry.npmjs.org/expo)                                     | 2026-10-15T14:38:57.611Z | Already aged                          |
| [react-native 0.86.3](https://registry.npmjs.org/react-native)                      | 2026-08-24T16:16:06.034Z | Already aged                          |
| [react-native-reanimated 4.5.5](https://registry.npmjs.org/react-native-reanimated) | 2026-08-27T09:54:46.024Z | Already aged                          |
| [expo-modules-core 57.0.23](https://registry.npmjs.org/expo-modules-core)           | 2026-10-14T16:35:22.439Z | Already aged                          |
| [electron-builder 26.18.0](https://registry.npmjs.org/electron-builder)             | 2026-10-20T21:24:08.041Z | 2026-11-20T21:24:08.041Z; still gated |
| [@electron/rebuild 4.2.1](https://registry.npmjs.org/@electron%2frebuild)           | 2026-10-06T22:35:19.105Z | Already aged                          |

These six examples do not establish age closure for all551records. Electron-builder reaches30days on2026-11-19 and one calendar month on2026-11-20; no exception or adoption is inferred from either date.

The Android patch incompatibility recorded in PR193 remains relevant: dependency
and patch-package versions must move together. Do not apply the beta lock wholesale
over the fork's newer markdown/security fixes. Publication ages of all 551 records
have not been audited; exclusion of the betas means none is introduced by this task.

The overlap/conflict statements above are source-based risk assessments, not a
performed beta merge or a tested conflict-resolution receipt. Granting a future
exception would require a separate per-behavior preservation matrix, per-version
age closure and platform validation. No deployment, release, daemon restart,
provider reload, credential copy or Mac access was performed for this comparison.
