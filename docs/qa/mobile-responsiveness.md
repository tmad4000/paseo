# Message-update responsiveness — pspin-bvs

Known chats keep their composer available during first history sync. Send releases the composer
after the device saves the complete message, while ordered host delivery continues in the background.
The passive sync badge sits inside the history area above the composer; user errors take priority,
and toast actions remain inside their native parent bounds for Android hit testing.

![390px viewport with history and Send acknowledgement held, and a second draft ready](mobile-responsiveness/phone-history-held.png)

## Source validation

The initial implementation and UI repairs at `c8ef9cda1` passed full workspace typecheck, lint,
formatting, 248 focused app tests, four tooltip browser component tests, and 12 selected
daemon-backed browser scenarios across runs. GitHub CI also passed on that revision. That CI run
does not validate the later delivery-coordination repairs.

The delivery repairs were checked on GCP `jacob-dev-1` using Node 22.23.3. The exact source revisions,
commands, exit codes and logs are retained in the task's validation receipts. Builds, full workspace and app typechecks, lint, formatting, focused unit/component tests and
daemon-backed browser flows were run there. Revision-specific commands and outcomes for the
published source are listed in the PR; earlier diagnostics are retained rather than counted as passes.

The published revision's required checks are recorded on [PR 207](https://github.com/tmad4000/paseo/pull/207).

The phone-width flow holds actual daemon WebSocket responses for first history and Send, submits
through the real composer, types a second draft before releasing either response, and verifies that
draft survives. Recovery cases exercise definite refusal, identical-ID/image-payload retry,
reconnect and status continuity. Other cases hold a direct request before host dispatch, save a
later queue message locally, then verify canonical delivery order. Routed Queue, ambiguous
one-shot recovery through reload, Send Back and reopening the original thread are covered too.

The history-layout test first verifies that its response text and read tool are absent from the
seeded history, then checks that both appear after Send. It retains the original row-stability
recorder. A total mounted-row count is unsuitable for virtualized
history: a new row can replace an older mounted row without increasing the count. Earlier
diagnostic failures and traces are retained; the assertions for a missing row and downward movement
were preserved.

## Review repairs

Independent review caught gaps in the first implementation:

- Refusal settlement now runs for composer delivery, reconnect and manual Retry, preserving the
  newer draft and the identical saved message identity and payload.
- Tooltip timing includes the actual child action and avoids nested double-counting. Sidebar
  Enter/Space actions preserve navigation isolation. Sync status preserves error priority and
  alert identity, and its native touch targets stay within parent bounds.
- One per-agent worker orders direct sends, queued messages, routing, Send Back and Stream replies.
  Creation order accounts for hydrated entries even after a backward device-clock change.
  Other chats and local cancellation can proceed independently.
- Unknown outcomes retain ownership across restart and slow or failed storage writes. One-shot
  routed sends have an explicit recovery hold and are never automatically replayed. The receipt
  owner normalizes the first ambiguous provider response and completion-write failures; the
  client also recognizes older daemon wording. Known pre-submission refusals remain distinct.
- Failed provisional saves and terminal routing preparation failures wake later saved work.
  A preparation wake-up runs only after its own entry is durably removed; retained failures do
  not trigger an implicit retry. Recovery releases ordering ownership only after persistence succeeds.
- Broadcast results distinguish device-pending saves from confirmed host delivery.
- Shared submit settlement checks draft revisions across encoding and storage, including text and
  attachment edits that return to identical content. Queue callbacks in the root composer, input
  widget and dictation use the same revision guard; unchanged acceptance still clears, while
  Queue as new message retains the composer. Both delivery paths reject incomplete image encoding
  before persisting or sending.
- Review cleanup removes only unchanged comments included in the submitted snapshot. Newer
  same-key review/context snapshots remain visible during preparation and survive settlement;
  discarded comments are not reconstructed.
- Preparation failures after newer edits retain the original message and attachment references in
  an explicit memory-only recovery track. Restore refuses an occupied composer and never sends;
  failed restores retain the copy and attachment holds, including protection from explicit deletion.
  Review/context-only edits and ABA owner updates retain the original snapshot too. Successful restore transfers images
  and immutable context/review snapshots to the composer without changing newer review comments.
- Direct RPC receipts wait on their reserved iterator's acceptance, preserving its original error.
  A later run cannot supply another request's refusal proof. Stale-session retry resolves the same
  acceptance promise and never replays after acceptance, timeout or cancellation. Generic failures
  and ambiguous steering retain their receipts.
- Review suppression compares the captured comment versions across diff-context rebuilds. User
  pill removals and reveals advance the shared draft revision synchronously, including before render
  and ABA actions. Submission suppression and cleanup do not count as edits or reveal user-removed
  reviews; actual new or edited comment versions remain visible.
- Delivery hydration and flushing use dependencies available when the composer loads, keeping
  lazy code-bundle fetches off the first-send path.

The independent source review completed at `0fc63b4a` with no remaining findings. GCP passed
499 server tests across eight suites and 159 focused composer/attachment tests across three
suites on that revision. The stored-byte cases use the production file store with a test filesystem:
a removed image remains readable and encodable while held, including after failed preparation,
and ordinary deletion works after every hold is released.

All eleven selected daemon-backed browser flows passed at `1847a0c5`. Its expanded app run passed
607 cases but exposed a missing React binding in three recovery-row cases and one outbox test
deadline; that outbox case passed unchanged in isolation. Follow-up fixes add the React import and
narrow the pull-request fixture type caught by typecheck. The assertions and timeouts are unchanged.
The published revision's commands, counts and required CI outcomes are listed on PR 207; earlier
receipts are retained as diagnostics rather than substituted for current-revision results. The
review-pill binding regressions and cold-import setup correction added after `8178d8d8` await the
outer executor's GCP checks. The draft dependency now loads during collection; the setup hook only
sets the React act environment. Behavioral assertions and timeouts are unchanged.

The queue cases cover held encoding/device saves, legacy local acceptance, failures, A→B→A
text edits, image changes, review/context-only versions, unchanged clearing and Queue as new
message. The layout selector chooses the first newly observed mock response/read tool while
retaining the zero-match preconditions and original row-stability checks. Runtime server source
is unchanged from the successful `98589884` server build.

The executable regressions use real store operations and held/failing storage to check ordering,
restart recovery, exclusion, cancellation, independent agents and automatic wake-ups. Dependency
compilation occurs in module setup outside timed storage assertions; cold module resets,
hydration scenarios and behavioral timeouts remain intact. Tests execute behavior rather than
checking implementation source strings.

## Performance evidence and limits

One synthetic run queues 1,024 assistant deltas for each of eight chats. Both implementations
produce identical final text. This isolates reducer/commit scheduling and excludes React rendering,
native touch dispatch and screen presentation; it is not an iPhone benchmark or a CI threshold.

| Node 22, 8,192 queued events |  Before |   After |
| ---------------------------- | ------: | ------: |
| Scheduled callbacks          |       1 |      64 |
| Longest callback             | 26.84ms |  4.81ms |
| p95 callback                 | 26.84ms |  0.56ms |
| Total reducer/commit time    | 26.84ms | 24.23ms |

The optional developer-web stream-smoothness experiment did **not** consistently meet its strict
12ms React p95 budget. Three baseline samples were 12.5/13.0/12.0ms; three interim patched samples
were 15.1/12.6/14.4ms. All six visible-update-gap p95 measurements were below the separate 250ms
budget. Workload phase and characters painted differed, so this is not a controlled release/native
comparison and does not establish either an iPhone improvement or a rendering regression. The
budget was not relaxed. Physical-device release profiling remains necessary.

Responsiveness diagnostics measure synchronous handlers, the next JS animation-frame callback,
event-loop stalls and reducer batches. They are bounded and contain no message text, route or
control labels. These measurements do not include native pre-JS input queuing, confirmed screen
presentation or asynchronous action completion. See [telemetry coverage](../agent-stream-performance.md#responsiveness-telemetry).

## Platform coverage

| Platform    | Coverage                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Browser web | Unit/component and daemon-backed flows; 390px layout visually inspected                                 |
| iOS         | Initial implementation's native JS export passed; optimized bytecode, signing and device checks pending |
| Android     | Shared behavior and native parent bounds reviewed; device verification pending                          |
| Electron    | Shared source checks and required PR CI; installed application not verified                             |

The optional Linux iOS export used Expo `--platform ios --no-bytecode --max-workers 2` with an
8 GiB Node heap. Optimized Hermes compilation exceeded that builder's memory budget, including a
standalone compile capped at 27 GiB virtual memory. This is build-time allocation, not phone memory.
An installable iOS build requires Apple tooling and signing, whether on a local or cloud Mac.

The user selected code and CI only. No app distribution, installation, signing changes or shared
daemon restart is included.
