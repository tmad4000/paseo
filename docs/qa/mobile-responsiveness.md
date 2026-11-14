# Message-update responsiveness — pspin-bvs

Known chats remain usable while their first history response is held. The device-save boundary
releases the composer before Send acknowledgement; pending/refused delivery remains recoverable.
The sync badge is passive and sits at the bottom of the history area, above the composer.
User toasts take priority in the same viewport. The viewport stays inside its native parent bounds
so toast actions remain touchable on Android.

![390px viewport with history and Send acknowledgement held, and a second draft ready](mobile-responsiveness/phone-history-held.png)

## Validation

Checked against the beta.30 source line (`accd8743a`) plus this change, using Node 22.20.0 on Linux:

- `npm run build:app-deps` and `npm run build:server`: pass.
- `npm run format`, `npm run lint`, `npm run typecheck`: pass. After moving the status badge,
  formatting/lint and the app typecheck were repeated and passed.
- App Vitest: 248 tests across composer actions, submission and writer, screen state,
  stream reducers, responsiveness metrics, shared outbox settlement, tooltip handlers and sync
  status: pass. The tooltip browser component suite adds four passing Chromium tests.
- `npx playwright test --project=browser e2e/browser/agent-timeline-sync-retry.spec.ts --workers=1`:
  3 pass, including the 390×844 viewport. It holds actual daemon WebSocket responses for first
  history and Send, submits through the real composer, starts a second draft before releasing
  either response, and checks that draft survives. The other cases exercise refusal/retry/recovery
  after first load and reconnect.

The queue regressions verify bounded scheduled batches, fairness between chats, lossless ordering
and a complete synchronous drain before canonical history. The Send regression leaves the host
promise unresolved and checks submission still finishes after the device save. Storage failure
and explicit/uncertain refusals remain covered.

### Review repairs

Independent review caught refusal settlement missing from reconnect/manual Retry and tooltip
measurement excluding the child action. Refusals now retire the matching live submission through
the shared flush path, leaving the saved message visible in Unsent. Uncertain outcomes remain live;
Retry sends the identical ID and payload. Icon tooltips measure wrapped child actions once.

The single status viewport preserves user-error priority and alert continuity during reconnect.
It is hosted inside the history area's bounds, above the composer, including native hit testing.
Sidebar mark-as-read handles Enter/Space without opening its parent workspace. Outline pointer
interactions wait for usable stable layout geometry.

Browser release-order tests hold all matching running snapshots, including attention/read updates,
until the test explicitly releases authoritative state. Legacy-host rejection tests explicitly disable
receipt support and retain their draft-restoration checks. A modern saved-send test holds the rejection
response while composing a newer draft, then checks Unsent recovery, attachment delivery, identical
retry ID, and the unchanged newer draft.

Before the shared delivery-order repair below, full workspace typecheck, lint, and the 248 focused app tests passed on GCP. The keyboard, outline,
three running-state delivery orders, legacy refusal/Steer, and reconnect status browser cases pass.
Saved-send recovery also passes: the host accepts one retry with identical image bytes and
message ID, while the newer draft remains unchanged. This fixture refuses before host dispatch;
ambiguous provider outcomes remain covered separately. The mock canonical echo omits image
previews, so delivery is checked through the complete outbound request payload and host acceptance.
All 12 focused daemon browser cases pass across these runs. The final phone screenshot was visually
inspected. Native build/device verification remains deferred; no signed package or rollout is included.

### Shared direct/queue ordering repair — verification pending

Review reproduced a source-level ordering gap: a saved direct send could still wait before host
dispatch while a later queued message reached an idle daemon. Both outboxes now use one per-agent
worker ordered by durable creation time. Transport failures and parked unknown outcomes retain
the barrier; definitive refusal, successful retry and explicit discard allow later delivery. Queue
removals bypass the delivery barrier, and other agents have independent workers.

Added executable regressions in `stores/send-outbox-store/index.test.ts` for held A / locally saved
B / later direct C, transport and unknown barriers across rehydration and fresh startup, identical retry, definitive
refusal, discard wake-up, cancellation and independent agents. `model.test.ts` checks that a new or
already parked unknown outcome blocks later direct sends. The daemon-backed
`agent-message-submission.spec.ts` case holds A's actual client request before forwarding, verifies
B's persisted device entry and absence from the host, keeps a newer draft editable, then releases A
and checks canonical A-before-B delivery.

The next source review found two remaining gaps: Find/Send and Send Back could still bypass the
worker, and restarting with a backward device clock could allocate an earlier creation time. Active
routed admissions now join the worker without releasing their undispatched hold or draft escrow;
Send Back saves in the queue outbox. The caller audit also coordinated broadcast, Stream replies,
direct routing and legacy composer delivery. New creation order observes both hydrated outboxes.
Host queue Send now keeps its explicit steering path.

Added unit cases cover routed admission behind held/unknown A, retry/discard wake-up, exclusion
revalidation, cancellation, Send Back, and all four older/newer outbox combinations with a backward
clock and delayed reads. Daemon-backed routing and threaded-reply regressions now hold A before host
dispatch, assert B remains device-only, and check canonical A-before-B order plus newer draft
preservation. The composer queue regression expects the actual capable-host `steer_only` behavior;
its ordering assertions are unchanged.

A further review found that a failed routed admission stopped the worker even after its durable
item was removed. The worker now continues when that admission has no unresolved saved entry.
Added the exact unknown-A / excluded-routed-B / ordinary-queue-C regression: discarding A must
automatically deliver C after B is removed, preserving B's draft. Separate cases retain B and C
after transport loss or an unknown outcome. Execution of these new cases is pending GCP validation.

The queue persistence suite now warms the real delivery dependency graph in a `beforeAll` hook.
Its existing cold resets, read/write holds and behavioral timeouts are unchanged. The outer executor
reported 37 passing queue tests with that diagnostic warm-up on interim source; this final repair
has not been tested here.

The outer executor reported that the corrected composer fixture reproduces B overtaking held A on
`c8ef9cda1` in GCP (`ordering-before.log` and synthetic trace). That is pre-fix evidence, not a passing
receipt for this source. These additions have not been executed in this M4 review/fix phase. The outer executor must run
focused unit/browser regressions and formatting/typecheck/lint on the existing GCP task. Earlier
passing receipts and the screenshot above do not validate this repair. Native rollout remains deferred.

## Burst comparison

One synthetic run queues 1,024 assistant deltas for each of eight chats, then measures each
scheduled reducer callback. Both versions produce the identical final text. This isolates reducer
and commit scheduling; it excludes React rendering, native touch dispatch and display presentation.
It is not an iPhone latency result or a performance threshold for CI.

| Node 22, 8,192 queued events |  Before |   After |
| ---------------------------- | ------: | ------: |
| Scheduled callbacks          |       1 |      64 |
| Longest callback             | 26.84ms |  4.81ms |
| p95 callback                 | 26.84ms |  0.56ms |
| Total reducer/commit time    | 26.84ms | 24.23ms |

## Platform coverage and remaining work

| Platform    | Verified                                                                         |
| ----------- | -------------------------------------------------------------------------------- |
| Browser web | Three daemon-backed flows; narrow layout visually inspected                      |
| iOS         | Native JS export passed on GCP; optimized bytecode/signing/device checks pending |
| Android     | Source and shared behavior tested; device verification pending                   |
| Electron    | Shared app typecheck; installed desktop behavior not verified                    |

No app distribution or shared daemon restart is part of this source receipt. Native release
profiling must confirm the actual touch-to-display improvement. See
[agent stream performance](../agent-stream-performance.md#responsiveness-telemetry) for telemetry
coverage, privacy, bounds and the difference between a frame callback and a completed action.

The optional Linux iOS JS export used Expo `--platform ios --no-bytecode --max-workers 2`
with an 8 GiB Node heap. Optimized Hermes compilation exceeded this builder's memory budget,
including a standalone compile capped at 27 GiB of virtual memory. That is build-time allocation,
not a measurement of phone runtime memory. A native release still requires Apple tooling and signing.
