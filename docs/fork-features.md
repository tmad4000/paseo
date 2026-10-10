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

| ID                        | Behavior to preserve / quick acceptance check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Source evidence and status at audit                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-favorites`       | Pin/Unpin an individual session from Chat or Stream; open it from Pinned sessions above Workspaces after reload. Preserve host/session identity, stable pin order, and archive/restore behavior.                                                                                                                                                                                                                                                                                                                                                                                        | **Source prepared; not installed.** `pspin-3vx`; UI: `packages/app/src/session-pins`; persistence and controls: [agent lifecycle](agent-lifecycle.md#individual-session-favorites). Existing daemon label API; old clients preserve metadata but do not show favorites.                                                                                                                         |
| `footer-time`             | At the bottom of a completed assistant reply, show its local completion time and duration together, such as **Finished 4:32 PM · 6m**, without hover or tap. Start time remains available on hover/tap when known; missing timestamps must not be invented.                                                                                                                                                                                                                                                                                                                             | **Restored in this source change (`code-76g`); installation pending `code-9yr`.** `AssistantTurnFooter` shows completion and duration together, with the actual start from turn timing on hover/tap. Ten focused label/timing tests pass. Original owner was spend-blocked; rollout owner resumed the restoration. The heavier browser regression remains deferred below.                       |
| `session-routing`         | Find an existing conversation within the chosen host/project scope, open or select it, and deliver a saved prompt to the chosen destination. Find includes host-acknowledged queued text and shows dated evidence.                                                                                                                                                                                                                                                                                                                                                                      | **On main.** [PR44](https://github.com/tmad4000/paseo/pull/44), [PR49](https://github.com/tmad4000/paseo/pull/49); contract: [session routing](session-routing.md); browser coverage: `packages/app/e2e/browser/session-routing.spec.ts`.                                                                                                                                                       |
| `route-best-match`        | Explicit **Route to best match** verb on a drafted Send prompt: one keyboard-accessible action chains search → select → queue-only delivery. Auto-selects only above the documented confidence threshold with clear margin over the runner-up; otherwise falls back to candidate choice (or new-session-with-draft) with the draft preserved. Receipt names the destination and offers **Wrong chat? Move draft**. Defaults to All-projects scope; respects an explicit scope. Passive Find/Send matching still never sends.                                                            | **Source prepared in this PR; not installed.** `pfork-rbm`; contract: [session routing — Route to best match](session-routing.md#route-to-best-match); unit coverage: `session-routing/model.test.ts`; browser coverage: `session-routing/composer.browser.test.tsx` (route success, ambiguous fallback, no-match new conversation).                                                            |
| `mobile-keyboard-dismiss` | While composing on a phone, a visible chevron-down button in the composer's button row (next to the attach button) dismisses the software keyboard without sending or losing the draft; tapping the input re-opens the keyboard. The button appears only while a software keyboard occupies screen space — never on web/desktop and never for a hardware keyboard — and the chat history's existing flick-down gesture remains the other dismissal path.                                                                                                                                | **Source prepared in this PR; not installed.** `pfork-kbd`; UI: `packages/app/src/composer/input/keyboard-dismiss-button.native.tsx` (web stub `keyboard-dismiss-button.tsx` renders nothing); visibility policy + unit coverage: `packages/app/src/composer/input/keyboard-dismiss-model.test.ts`; dismissal reuses the blur+dismiss pair validated by `agent-stream/scroll-keyboard-dismiss`. |
| `quick-launch`            | Mod+Shift+L, the command center, or the Quick launch sidebar item opens a dialog that starts an agent without leaving the current tab: prompt, project (default from `resolveQuickLaunchDefaultDestination`), New workspace or New tab in the current workspace, Agent controls. Start keeps the user in place and shows a toast with **Open**; Start and open navigates after creation; a failure toast offers **Retry** with the prompt intact. One create request per Start, no duplicate agent. The router's New conversation offers **Start without leaving**.                     | **Source prepared in this PR; not installed.** `pspin-sp2`; contract: [Quick launch](quick-launch.md); unit coverage: `quick-launch/destination.test.ts`, `quick-launch/launch.test.ts`, `sidebar-nav/model.test.ts`, `keyboard/keyboard-shortcuts.test.ts`. Browser coverage is a follow-up.                                                                                                   |
| `dispatcher-create-modes` | From the central dispatcher, start a new conversation through the composer with workspace selection and the scratch-workspace default; offer Queue, Steer, and Interrupt for existing destinations.                                                                                                                                                                                                                                                                                                                                                                                     | **Merged on main; installation pending `code-9yr`.** [PR50](https://github.com/tmad4000/paseo/pull/50) owns implementation; the installed acceptance checklist below remains open.                                                                                                                                                                                                              |
| `conversation-sort`       | Offer Latest conversation activity (default), Your last message, AI’s last reply, Manual order, and Title A–Z. Remember the choice; tools/settings do not advance message clocks; pinned order remains stable.                                                                                                                                                                                                                                                                                                                                                                          | **Merged on main; installation pending `code-9yr`.** [PR52](https://github.com/tmad4000/paseo/pull/52) owns role-clock semantics, unknown-history behavior, host gating, and acceptance evidence.                                                                                                                                                                                               |
| `pinned-default-project`  | Pin/Unpin a project and Make default project from the project row menu and Command Center. Pinned projects sit above the rest in every sort mode, Default first with a house glyph; the host Workspaces settings page picks the Default. Sidebar New conversation lands in the Default project. Pins and the Default survive reload and agree across devices on one host.                                                                                                                                                                                                               | **Source prepared; not installed.** `pspin-9b3`; UI: `packages/app/src/default-project`; daemon `project.pin.set` / `project.default.set` behind `projectPinning`. Behavior: [sidebar sorting](sidebar-sorting.md#pinned-projects), [session routing](session-routing.md#new-conversation-and-delivery-mode).                                                                                   |
| `sidebar-deep-filter`     | Typing in the sidebar find field filters live by project, workspace, and tab titles; matching tabs appear nested under their workspace and open on click. After a short pause, an **In messages** group lists message-text hits newest first and opens the chat. Enter still runs intelligent Find; old hosts simply show no message group.                                                                                                                                                                                                                                             | **Pending PR (`pspin-78j`).** Contract: [sidebar filter](sidebar-filter.md); RPC `session.text_search`, host feature `sessionTextSearch`.                                                                                                                                                                                                                                                       |
| `busy-send-queue`         | Busy-chat send actions expose their delivery behavior. Queueing preserves the running turn; queued text survives host acknowledgement/reload and can be recovered for editing.                                                                                                                                                                                                                                                                                                                                                                                                          | **On main.** [PR23](https://github.com/tmad4000/paseo/pull/23), [PR32](https://github.com/tmad4000/paseo/pull/32), [PR36](https://github.com/tmad4000/paseo/pull/36), [PR38](https://github.com/tmad4000/paseo/pull/38); contract: [queue mirroring](queue-mirroring.md). Use a disposable agent for interruption checks.                                                                       |
| `artifact-feed`           | A conversation exposes its collected files for preview/opening, and persisted artifact metadata survives reload.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **On main.** Original contract and prior verification: [artifact feed notes](../NOTES.md); source: `packages/app/src/artifacts/feed.tsx` and `packages/server/src/server/agent/artifacts/collector.ts`.                                                                                                                                                                                         |
| `durable-stream-asks`     | Preserve all captured Stream history; page reads; explicit stable-ID asks show unresolved work, blockers, evidence and delegated session links; done/reopen never follows turn lifecycle.                                                                                                                                                                                                                                                                                                                                                                                               | **Implemented on feature branch, not installed.** `pspin-8v6`; contract: [Stream checklist](companion-stream.md#durable-ask-checklist). Validate retention beyond 50, storage reload, bounded snapshots, pagination and revision conflicts before rollout.                                                                                                                                      |
| `stream-questions`        | Per-chat and global Stream show source-linked activity. Questions and pins survive reload; marking one question Done does not resolve another. Offline/unsupported hosts are identified.                                                                                                                                                                                                                                                                                                                                                                                                | **On main.** [PR51](https://github.com/tmad4000/paseo/pull/51); contract: [Stream](companion-stream.md); browser coverage: `packages/app/e2e/browser/global-stream.spec.ts` and `global-stream-host-evidence.spec.ts`.                                                                                                                                                                          |
| `cross-project-views`     | A saved View combines panes from different workspaces and restores each pane's own scope after reload; compact layouts retain access to those panes.                                                                                                                                                                                                                                                                                                                                                                                                                                    | **On main.** [PR39](https://github.com/tmad4000/paseo/pull/39), [PR41](https://github.com/tmad4000/paseo/pull/41), [PR42](https://github.com/tmad4000/paseo/pull/42); contract: [cross-project views](cross-project-views.md).                                                                                                                                                                  |
| `workspace-unread`        | Workspace agent tabs surface unread activity and keep their intended ordering; marking a workspace unread remains available.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **On main.** [PR33](https://github.com/tmad4000/paseo/pull/33); browser coverage: `packages/app/e2e/browser/sidebar-workspace-mark-unread.spec.ts`.                                                                                                                                                                                                                                             |
| `focus-history`           | Browser-style Back and Forward through recently focused workspaces, tabs, panels and app pages. Header buttons (Forward hidden on phones until there is somewhere to go), Cmd/Ctrl+Alt+Left/Right, mouse side buttons, macOS page swipe, Windows/Linux browser keys, Android hardware Back. Focusing somewhere new drops the Forward branch. A restore that cannot land (closed tab, deleted workspace) is skipped, never leaves the buttons stuck disabled.                                                                                                                            | **Source prepared in this PR; not installed.** `pspin-138`; model: `packages/app/src/navigation/focus-history.ts`; wiring: `focus-history-runtime.tsx`; desktop gestures: `packages/desktop/src/window/window-manager.ts` (`setupNavigationGestureEvents`). Unit coverage in the matching `.test.ts` files.                                                                                     |
| `recent-workspaces`       | Switch between recently used workspaces. Ctrl+Tab on desktop (browsers own Ctrl+Tab, so web relies on Cmd+K and the history menu): a quick tap goes to the previous workspace; hold Control and press Tab/Shift+Tab or arrows to walk the list, release to switch, Esc to cancel. Cmd+K lists workspaces most-recent-first when the query is empty (current workspace after the others). Right-click or long-press Back/Forward lists that direction's history; picking an entry jumps there in one step. The recency list survives reload.                                             | **Source prepared in this PR; not installed.** `pspin-8o4`; model: `packages/app/src/navigation/recent-workspaces.ts`; switcher: `recent-workspace-switcher-store.ts` + `recent-workspace-switcher.tsx`; history labels: `focus-history-labels.ts`; persisted list: `packages/app/src/stores/recent-workspaces-store.ts`. Unit coverage in the matching `.test.ts` files.                       |
| `recent-sessions`         | A visible clock button beside Back/Forward opens a Recent sessions menu: up to 10 agent sessions you most recently focused, newest first, without the one on screen; each row shows the provider icon, title, project · workspace and when you were last there, plus the running/attention dot. "Show all…" opens Cmd+K on the full recent list (also Cmd/Ctrl+Alt+R, rebindable, and the "Recent sessions…" command). Phones show the button once there is a recent session. Session and workspace recency come from one persisted visit list, so this menu, Ctrl+Tab and Cmd+K agree. | **Source prepared in this PR; not installed.** `pspin-11e`; button/menu: `packages/app/src/components/headers/recent-sessions-button.tsx`; rows: `navigation/recent-sessions.ts` + `use-recent-session-rows.ts`; visit list: `navigation/recent-workspaces.ts`, `stores/recent-visits-store.ts`. Unit coverage in the matching `.test.ts` files.                                                |
| `fork-identity`           | The packaged app, CLI, URL handling and update channel retain the fork identity; launching the fork preserves the intended existing sessions.                                                                                                                                                                                                                                                                                                                                                                                                                                           | **On main.** [Fork identity/build instructions](../FORK.md), `packages/desktop/electron-builder.fork.cjs`. Verify the actual bundle and host used for installation.                                                                                                                                                                                                                             |

“On main” above means source integration was found, not that every platform has been exercised.
Pending rows become preservation requirements for the release that first includes them. Keep a
regressed row visible until its restoration is verified; documenting it does not mark it fixed.

## Combined beta.11 candidate (`code-9yr` / `code-c66`)

Prepared from main `4357e22db` (including queue receipt fix PR56), Stream PR57
`7f24232a6`, session favorites PR58 `b25764ec9`, and optional voice PR59 `f93c83685`.
The pre-version combined tree is `4adbc80e5b5e807bed926e22a7483f0b7742d399`.
This records source scope, not merge approval or installed acceptance.
Stream test-only follow-up `4eebe5136` waits for a virtualized completed card to settle
in the viewport. It changes no runtime source; retain exact old/new test blobs in the
release source-equivalence receipt before reusing an already signed candidate.

All existing register features are retained in this candidate. Session favorites and durable
Stream are additions; optional OpenAI voice retains the existing Paseo provider and requires
explicit opt-in. Its [acceptance limits](openai-realtime-voice.md#delivery-and-operational-limits)
remain open, including physical audio and phone checks. No dependency versions are upgraded.
The prior signed beta.10 package and TestFlight build 10000010 predate these additions.

Release owner `code-9yr` must finish exact-source CI/review, signed desktop/iOS validation,
and packaged feature acceptance before transitioning its existing controller. Desktop installs
require fleet idle, idle voice, accounted queues, and no owned terminals. The hash-bound alias
repair (`code-nnl`, PR55) is separate offline maintenance; its explicit maintenance-order
exception is still held. No queue bypass or restart is implied by this source preparation.

**Host first.** Cut the M4 daemon over before, or together with, any client install (M5, M3,
phone). Most chats live on the M4 host, and clients newer than that host lose host-gated
features. Remote beta.5/6 and beta.11 clients ran days ahead of the M4 daemon this way, which
caused the repeated "Update the host to use Stream" (`pspin-6ck`). The M4 LaunchAgent
`sh.paseo.daemon` and the `paseo`/`paseo-fork` links point at a staged bundle under
`code-overflow/paseo-fork-releases/<version>/`, not `/Applications`. Installing the app there
does not upgrade the daemon. Only the cutover does. On M4, `com.jacob.paseo-stream-guard` alerts
by Telegram when the host lacks Stream flags or a client is newer than the host.

`code-tie` remains outstanding: provider and terminal ownership must survive daemon replacement,
UI Quit must leave runtime running by default, and identities, events and pending permissions
must reattach without duplicate prompts. This candidate does not implement those guarantees.
Restoring saved conversation history does not preserve an in-flight turn. Idle-only delivery
can proceed separately when its gates clear. Historical missing Stream entries (`code-g29`)
remain a separate, unapplied recovery task; neither PR51 nor PR57 backfills provider history.

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

## Sidebar follow-up

Repository issues are disabled, so this stable ID also serves as the follow-up ticket.

- [ ] `pfork-sbt`: show a visible last-message timestamp on each sidebar session row.
      [PR52](https://github.com/tmad4000/paseo/pull/52) added the `messageActivity` role clocks
      and the sort modes only — nothing renders a time in the sidebar list today (no time
      formatting in the `packages/app/src/components/sidebar/` row components). Render the same
      clock the active message sort uses ([sidebar sorting](sidebar-sorting.md)): accepted user
      messages and completed assistant replies only, and never an invented time when a clock is
      unknown, matching `footer-time`'s no-invented-timestamps rule. Once implemented, this
      becomes a register row to preserve across upstream merges.

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
