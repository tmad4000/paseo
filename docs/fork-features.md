# Fork feature preservation

This register records the user-visible behavior Paseo Fork intends to preserve across upstream
updates and fork reconciliation. Update it in the PR that adds, replaces, restores, or intentionally
retires a fork behavior. Keep stable feature IDs when implementations move.

Source status and installation status are separate. The initial source audit below is against
`origin/main` at `51a57be66` on 2026-10-06; it is not an installed-build acceptance report.
A merged PR, retained helper, passing typecheck, or old screenshot cannot establish that the current
UI still exposes the feature. Add newly discovered fork behaviors here; this starting inventory
covers the known workflows below, not an exhaustive audit of every historical fork commit.

## Feature register

| ID                        | Behavior to preserve / quick acceptance check                                                                                                                                                                                                               | Source evidence and status at audit                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `footer-time`             | At the bottom of a completed assistant reply, show its local completion time and duration together, such as **Finished 4:32 PM · 6m**, without hover or tap. Start time remains available on hover/tap when known; missing timestamps must not be invented. | **Restored in this source change (`code-76g`); installation pending `code-9yr`.** `AssistantTurnFooter` shows completion and duration together, with the actual start from turn timing on hover/tap. Ten focused label/timing tests pass. Original owner was spend-blocked; rollout owner resumed the restoration. The heavier browser regression remains deferred below. |
| `session-routing`         | Find an existing conversation within the chosen host/project scope, open or select it, and deliver a saved prompt to the chosen destination. Find includes host-acknowledged queued text and shows dated evidence.                                          | **On main.** [PR44](https://github.com/tmad4000/paseo/pull/44), [PR49](https://github.com/tmad4000/paseo/pull/49); contract: [session routing](session-routing.md); browser coverage: `packages/app/e2e/browser/session-routing.spec.ts`.                                                                                                                                 |
| `dispatcher-create-modes` | From the central dispatcher, start a new conversation through the composer with workspace selection and the scratch-workspace default; offer Queue, Steer, and Interrupt for existing destinations.                                                         | **Pending, not baseline behavior on main.** [PR50](https://github.com/tmad4000/paseo/pull/50) owns implementation and acceptance gaps. Promote this row after merge and record installation separately.                                                                                                                                                                   |
| `conversation-sort`       | Offer Latest conversation activity (default), Your last message, AI’s last reply, Manual order, and Title A–Z. Remember the choice; tools/settings do not advance message clocks; pinned order remains stable.                                              | **Merged on main; installation pending `code-9yr`.** [PR52](https://github.com/tmad4000/paseo/pull/52) owns role-clock semantics, unknown-history behavior, host gating, and acceptance evidence.                                                                                                                                                                         |
| `busy-send-queue`         | Busy-chat send actions expose their delivery behavior. Queueing preserves the running turn; queued text survives host acknowledgement/reload and can be recovered for editing.                                                                              | **On main.** [PR23](https://github.com/tmad4000/paseo/pull/23), [PR32](https://github.com/tmad4000/paseo/pull/32), [PR36](https://github.com/tmad4000/paseo/pull/36), [PR38](https://github.com/tmad4000/paseo/pull/38); contract: [queue mirroring](queue-mirroring.md). Use a disposable agent for interruption checks.                                                 |
| `artifact-feed`           | A conversation exposes its collected files for preview/opening, and persisted artifact metadata survives reload.                                                                                                                                            | **On main.** Original contract and prior verification: [artifact feed notes](../NOTES.md); source: `packages/app/src/artifacts/feed.tsx` and `packages/server/src/server/agent/artifacts/collector.ts`.                                                                                                                                                                   |
| `durable-stream-asks`     | Preserve all captured Stream history; page reads; explicit stable-ID asks show unresolved work, blockers, evidence and delegated session links; done/reopen never follows turn lifecycle.                                                                   | **Implemented on feature branch, not installed.** `pspin-8v6`; contract: [Stream checklist](companion-stream.md#durable-ask-checklist). Validate retention beyond 50, storage reload, bounded snapshots, pagination and revision conflicts before rollout.                                                                                                                |
| `stream-questions`        | Per-chat and global Stream show source-linked activity. Questions and pins survive reload; marking one question Done does not resolve another. Offline/unsupported hosts are identified.                                                                    | **On main.** [PR51](https://github.com/tmad4000/paseo/pull/51); contract: [Stream](companion-stream.md); browser coverage: `packages/app/e2e/browser/global-stream.spec.ts` and `global-stream-host-evidence.spec.ts`.                                                                                                                                                    |
| `cross-project-views`     | A saved View combines panes from different workspaces and restores each pane's own scope after reload; compact layouts retain access to those panes.                                                                                                        | **On main.** [PR39](https://github.com/tmad4000/paseo/pull/39), [PR41](https://github.com/tmad4000/paseo/pull/41), [PR42](https://github.com/tmad4000/paseo/pull/42); contract: [cross-project views](cross-project-views.md).                                                                                                                                            |
| `workspace-unread`        | Workspace agent tabs surface unread activity and keep their intended ordering; marking a workspace unread remains available.                                                                                                                                | **On main.** [PR33](https://github.com/tmad4000/paseo/pull/33); browser coverage: `packages/app/e2e/browser/sidebar-workspace-mark-unread.spec.ts`.                                                                                                                                                                                                                       |
| `fork-identity`           | The packaged app, CLI, URL handling and update channel retain the fork identity; launching the fork preserves the intended existing sessions.                                                                                                               | **On main.** [Fork identity/build instructions](../FORK.md), `packages/desktop/electron-builder.fork.cjs`. Verify the actual bundle and host used for installation.                                                                                                                                                                                                       |

“On main” above means source integration was found, not that every platform has been exercised.
Pending rows become preservation requirements for the release that first includes them. Keep a
regressed row visible until its restoration is verified; documenting it does not mark it fixed.

## Dispatcher follow-up checklist

Jacob requested these together on 2026-10-06. [PR50](https://github.com/tmad4000/paseo/pull/50)
owns implementation and validation; its PR checklist tracks code completion. The checks below are
release acceptance for the build that includes that PR. Keep them open until the corresponding
installed-build receipt records the observation. Repository issues are disabled, so these stable
IDs also serve as the follow-up issue list.

- [ ] `dispatcher-queue`: show an explicit Queue delivery option, alongside Steer and Interrupt;
      queueing a prompt to a busy disposable chat preserves its active turn and acknowledges the item.
- [ ] `dispatcher-clear`: provide an accessible Clear control for the Send prompt input and a
      consistent explicit clear path for Find. Clearing removes that input and its visible results;
      the other mode's independent draft/query stays intact. It must not cancel or discard an uncertain
      delivery already owned by the outbox.
- [ ] `dispatcher-edit-results`: after Find or Send matching returns chats, editing the input keeps
      those results visible. They remain tied to the prior lookup until an explicit new lookup replaces
      them; a delayed old response must not overwrite a newer lookup. Scope/host changes still exclude
      invalid destinations.
- [ ] `dispatcher-find-first`: when the main action searches for a destination, label it **Find first**
      in Send mode and do not deliver to an unseen match. After explicit recipient selection, label the
      action for its actual delivery mode. Find remains search-only.
- [ ] `dispatcher-current-draft`: after editing a prompt while prior results are visible, explicitly
      choosing a destination sends the current prompt exactly once; a stale lookup must never send an
      older draft or silently route the new one.
- [ ] `dispatcher-new-chat`: expose New conversation directly from the dispatcher and preserve the
      prompt through the new-chat composer handoff; choosing a destination alone does not send it.
- [ ] `dispatcher-workspace`: default new conversations to the unambiguous selected-host
      `tmpworkspace`, with project/workspace/host visible and manually selectable. Respect an explicit
      project scope; require a choice when the default is missing or ambiguous.

These extend `dispatcher-create-modes` and `session-routing`; preserve them when an upstream
implementation replaces either feature. The deferred footer test below remains a separate task.

## Reviewing an upstream update or reconciliation

1. Record the previous shipped fork commit, candidate fork commit, and incoming upstream tag/commit.
   Read this register from the previous fork as well as the candidate: a merge can delete its own
   checklist or tests. Preserve this register and the links to it during conflict resolution.
2. Review the source diff and relevant existing evidence for each included feature. Add one row per
   feature ID to the integration PR: **preserved**, **replaced by upstream**, **regressed**, or
   **intentionally retired**. Include the old/new source paths, observed behavior, and evidence link.
   Pending features outside the candidate are marked **not included**.
3. For upstream replacements, apply the same acceptance check to the new UI. Move/delete old
   implementation code only after accounting for the behavior and its tests. Record the user decision
   for a deliberate behavior removal; upstream winning a code conflict is not evidence of parity.
4. Resolve new regressions or explicitly list them as release limitations before calling the
   reconciliation complete. Preserve known gaps with an owner and follow-up; never silently drop a row.

Copy this small matrix into the integration PR or release receipt:

| Feature ID    | Candidate disposition                                                | Old/new implementation or PR | Observation and evidence | Follow-up/owner                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------- | ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `footer-time` | regressed / preserved / replaced by upstream / intentionally retired |                              |                          | **Restored in this source change (`code-76g`); installation pending `code-9yr`.** `AssistantTurnFooter` shows completion and duration together, with the actual start from turn timing on hover/tap. Ten focused label/timing tests pass. Original owner was spend-blocked; rollout owner resumed the restoration. The heavier browser regression remains deferred below. |

## Installed-build smoke receipt

For an authorized installation or upgrade, exercise the register's quick acceptance checks for
included features in the actual packaged app. A source-tree dev server does not establish which
bundle was installed. Start with affected features and known regressions, including `footer-time`;
account for every included feature as **pass**, **fail**, or **not checked**. Reuse a recorded result
only when the relevant artifact and environment are unchanged, and link that receipt.

Record:

- Date, machine, platform, app version/build and source commit; installed bundle path and artifact
  digest or build receipt; connected daemon version and source commit when known.
- Feature ID, steps taken, expected and observed behavior, and screenshot/log/test evidence.
- Any unavailable platform or untested behavior, who owns follow-up, and the restoration PR.

Use disposable conversations/workspaces for prompts, queueing and interrupt checks. Preserve live
sessions and follow the existing installation/restart authorization rules. Agents should perform
checks hands-free where possible; mark unavailable checks explicitly rather than asking Jacob to
repeat routine QA. Report **code merged**, **artifact built**, **installed**, and **smoke verified**
as separate states, with results for each target machine/platform.

## Deferred automation

Jacob prioritized this lightweight register on 2026-10-06 and allowed the new footer browser
regression test to follow later. This change adds no CI job, full-suite run, or installed-app launch.
Existing checks still apply to code changes.

- [ ] `footer-time` owner: when restoring the footer, add a focused case to an existing browser suite
      that renders a completed reply and asserts both completion time and duration are visible before
      hover/tap. Cover missing timestamps without invented times. Retain it through future merges.
- [ ] Integrate that case into the existing applicable browser CI job; record its runtime before
      considering additional release-wide automation. Reuse current jobs rather than adding a new suite.
- [ ] Release owner: attach the first installed-build smoke receipt using this register at the next
      authorized fork upgrade, including any known regression that remains unresolved.
- [ ] Fork maintainer: extend the initial inventory as additional historical fork differences are
      identified; audit the remaining legacy feature branches without assuming they all reached main.

Until those automation items land, the preservation matrix and release smoke receipt are process
checks, not an automated guarantee that a regression will be blocked.

### Stream message coverage and navigation (pspin-05x; dependent on PR #57)

Activity defaults to all captured content; explicit status/source filters show counts and reset.
User-message coverage is durable and distinct from semantic asks and completion evidence.
`list_stream_asks` includes unreviewed source messages; `review_stream_message` links multiple
asks without resolving them. Copy Stream link preserves the host/session view across routing
and reload. Requires `server_info.features.streamMessageInventory`. Older unavailable history
is labeled; no provider-history rewrite, background inference service, deployment or favorite
session implementation is included. See [companion-stream.md](companion-stream.md).
