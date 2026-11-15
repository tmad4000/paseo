# Agent peek and the spawned-agent registry — QA (pspin-sgu, Phase 1 PR A)

Screenshots come from `packages/app/e2e/browser/agent-peek-registry.spec.ts`, run on Linux
(Chromium, Playwright `browser` project) against the e2e harness's isolated daemon with the mock
provider. Spawned agents are real mock agents labelled with their parent. Provider subagents are
three descriptors injected into the daemon's `agent.provider_subagents.list.response` for the
orchestrator, because the mock provider has no provider runtime.

| File                   | Shows                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `track-panel-1440.png` | Track panel with **Spawned agents · 2** then **Provider subagents · 3**, each in creation order (provider tasks are older)           |
| `registry-1440.png`    | Registry beside the chat: both groups open, one spawned card expanded (mode, directory, Peek / Open in tab / overflow), ages, models |
| `asks-pane-1440.png`   | Questions and asks pane: the open ask with its pulse chip, and **Spawned agents · 2 · 1 working** unfolded with one-line rows        |
| `peek-1440.png`        | A row in the pane peeked the reviewer beside the parent; the reply reached only the child; the parent's draft is intact              |
| `registry-390.png`     | Phone width: the panel covers the chat; chevron, card actions and group headings are visible without hover                           |
| `peek-390.png`         | Phone width: the peeked child's chat with **Reply to phone builder**                                                                 |
| `asks-pane-390.png`    | Phone width: the pane's Spawned agents section unfolded                                                                              |

## Platform coverage

| Platform        | Tested | Notes                                                                                    |
| --------------- | ------ | ---------------------------------------------------------------------------------------- |
| Web (Linux)     | Yes    | Chromium via Playwright, 1440×900 and 390×844                                            |
| Desktop Linux   | No     | Electron not run; the change has no Electron-only code                                   |
| Desktop macOS   | No     | Not run. Linux web results do not verify macOS                                           |
| Desktop Windows | No     | Not run                                                                                  |
| iOS             | No     | Not run. Roving focus and Mod+click are web-only; native shows every control as a button |
| Android         | No     | Not run                                                                                  |

## Covered

- Two headed groups in the track panel and the registry, never interleaved, creation order.
- Default folds (spawned open, provider folded when spawned agents exist), the folded summary,
  and both folds surviving a reload; card expansion not surviving it.
- Card: state word, model, ticking age; expansion in place with actions, no tab opened.
- Peek from a registry card, from a Spawned agents row in the pane, and from a delegation pulse
  chip; reply reaches only the child; parent draft intact.
- Keyboard: Up and Down across groups, Right and Left on a card, Escape on the peek header back to
  the list with focus on the card, Mod+Enter opening the tab.
- The pane section starts folded and its fold survives a reload.
- At 390px the panel covers the chat and its controls are visible without hover.

## Not covered

- A host without `providerSubagents` or `companionStream` in a browser run. Unit tests cover the
  selectors (`subagents/select.test.ts`, `subthreads/model.test.ts`).
- Real Claude or Codex provider subagents (injected descriptors only).
- Mod+click and middle-click with a real pointer (unit-tested through the press handler).
- Screen reader output; accessible names and `aria-expanded` are asserted in the spec.
- Long reports, task progress and pending permissions on a live agent: the mock agents write no
  Stream outcome and no task list. `subthreads/model.test.ts` covers the derivation.

## Found, not fixed here

At 390px the floating pane's fixed top offset (`answers-pane.tsx`, `anchorCompact.top`) overlaps the
second row of the chat header when that header wraps (Subagents and Checklist buttons). The offset
predates this change; see `asks-pane-390.png`.
