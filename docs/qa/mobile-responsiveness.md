# Message-update responsiveness — pspin-bvs

Known chats remain usable while their first history response is held. The device-save boundary
releases the composer before Send acknowledgement; pending/refused delivery remains recoverable.
The sync badge is passive and sits above the composer without moving the history or covering
navigation.

![390px viewport with history and Send acknowledgement held, and a second draft ready](mobile-responsiveness/phone-history-held.png)

## Validation

Checked against the beta.30 source line (`accd8743a`) plus this change, using Node 22.20.0 on Linux:

- `npm run build:app-deps` and `npm run build:server`: pass.
- `npm run format`, `npm run lint`, `npm run typecheck`: pass. After moving the status badge,
  formatting/lint and the app typecheck were repeated and passed.
- App Vitest: 234 tests across `composer/actions.test.ts`, `composer/submit.test.ts`,
  `composer/submission/writer.test.ts`, `hooks/use-agent-screen-state-machine.test.ts`,
  `timeline/session-stream-reducers.test.ts`, `performance/responsiveness.test.ts` and
  `performance/response-monitor.test.ts`: pass.
- `npx playwright test --project=browser e2e/browser/agent-timeline-sync-retry.spec.ts --workers=1`:
  3 pass, including the 390×844 viewport. It holds actual daemon WebSocket responses for first
  history and Send, submits through the real composer, starts a second draft before releasing
  either response, and checks that draft survives. The other cases exercise refusal/retry/recovery
  after first load and reconnect.

The queue regressions verify bounded scheduled batches, fairness between chats, lossless ordering
and a complete synchronous drain before canonical history. The Send regression leaves the host
promise unresolved and checks submission still finishes after the device save. Storage failure
and explicit/uncertain refusals remain covered.

### Review repair validation pending

The review repair centralizes refusal settlement for composer, reconnect and manual Retry,
measures the full tooltip child action, and restores user-error priority and alert continuity
above the composer. Sidebar mark-as-read now handles Enter/Space without opening its parent
workspace. Outline pixel interactions wait for two usable, matching layout boxes.

The outer executor owns cloud execution of the new regressions; this repair has not run tests,
builds, typecheck, lint or formatting on M4. Run these focused checks on the existing cloud builder:

- App Vitest: `stores/send-outbox-store/index.test.ts`, `components/ui/tooltip.test.tsx`,
  `timeline/sync-status.test.tsx`, plus existing `composer/actions.test.ts` and
  `performance/response-monitor.test.ts`.
- Browser Playwright: `sidebar-workspace-mark-unread.spec.ts` (both keyboard cases),
  `viewed-agent-timelines.spec.ts` (error priority, stable alert and reconnect), and
  `chat-outline.spec.ts` (stable geometry with the existing hover assertions).
- Format the touched files, then run the app typecheck and targeted lint through the repository
  scripts before accepting the repair. Native build and device verification remain deferred.

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

| Platform    | Verified                                                                       |
| ----------- | ------------------------------------------------------------------------------ |
| Browser web | Three daemon-backed flows; narrow layout visually inspected                    |
| iOS         | Source and shared behavior tested; native release build/device latency pending |
| Android     | Source and shared behavior tested; device verification pending                 |
| Electron    | Shared app typecheck; installed desktop behavior not verified                  |

No app distribution or shared daemon restart is part of this source receipt. Native release
profiling must confirm the actual touch-to-display improvement. See
[agent stream performance](../agent-stream-performance.md#responsiveness-telemetry) for telemetry
coverage, privacy, bounds and the difference between a frame callback and a completed action.
