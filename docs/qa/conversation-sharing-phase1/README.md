# Conversation sharing QA

## Phase 1c follow-ups — 2026-10-24

M4 macOS, `feat/sharing-followups`, Beads `pspin-twk.14`, `twk.9`, `twk.8`, `twk.4`.
No main-daemon access, deployment, tunnel changes, UI string changes or local Playwright run.
The Worker deployment/round-trip status was reported by Fable; this batch did not probe it.

| Focused test file                                             | Passed | Output                                     |
| ------------------------------------------------------------- | -----: | ------------------------------------------ |
| `packages/server/src/server/sharing/redaction-corpus.test.ts` |    148 | [Corpus](followups/redaction-corpus.txt)   |
| `packages/server/src/server/sharing/share-listener.test.ts`   |     34 | [Listener](followups/listener.txt)         |
| `packages/server/src/server/sharing/render.test.ts`           |     12 | [Render](followups/render.txt)             |
| `packages/server/src/server/config.test.ts`                   |     13 | [Config](followups/config.txt)             |
| `packages/app/src/utils/markdown-parser.test.ts`              |      6 | [App Markdown](followups/app-markdown.txt) |
| `packages/server/src/server/sharing/sharing.e2e.test.ts`      |      5 | [Daemon e2e](followups/e2e.txt)            |

218 focused tests passed. Files ran individually using
`npx vitest run <file> --bail=1 > /tmp/sharing-followups-<name>.txt 2>&1`.
The [new prose negatives failed before the redaction fix](followups/redaction-corpus-before.txt);
[HEAD failed before listener hardening](followups/listener-before.txt), and
[CONNECT failed before its explicit rejection](followups/listener-connect-before.txt).
The passing cases check exact text, counters, idempotence, trusted/untrusted peers including
IPv4-mapped IPv6 and CIDR boundaries, raw URL/method rejection before storage, HEAD header/body
parity, server timeout/header settings and 600 successful HTTP requests across forwarded keys
followed by a globally limited request. A fake reader is injected through the reader interface;
HTTP is real and the daemon e2e uses isolated state. No production process was started or stopped.

Before upgrading, two exact HTML snapshots were generated with markdown-it 10:
[server baseline run](followups/render-baseline.txt), [app baseline run](followups/app-markdown-baseline.txt).
Those fixtures are unchanged under 14.3.2, including whitespace, Markdown structure, escaping,
links and the shared page shell. The only existing fixture adjustment removes `(p)`/`(P)` from
expected typographer-on rewrites because 14 no longer rewrites them; typographer-off literal
preservation still asserts both. Three generic `command -p` corpus fixtures now name `sshpass`;
a generic `command -p` is explicitly negative. Canonical unpadded Basic `user:password` pairs
remain recognized to preserve the supplied `Basic dXNlcjpwYXNz` positive.

The [resolved dependency tree](followups/markdown-dependencies.txt) contains only markdown-it
14.3.2, including the scoped `react-native-markdown-display` override. Both workspaces use
`@types/markdown-it` 14.2.0. [npm publication dates](followups/dependency-dates.txt) verify the
one-month policy for every newly resolved version; 14.3.3 was not selected.
`npm install` / the targeted `npm update markdown-it` used `--ignore-scripts --no-audit --no-fund`.
The targeted update was needed to apply the new override to an existing lockfile.

Required checks: [build:server](followups/build-server.txt), [typecheck](followups/typecheck.txt),
[lint](followups/lint.txt), [format](followups/format.txt). Full-suite verification belongs to PR CI.

## Phase 1c publisher — 2026-10-24

M4 macOS, `feat/sharing-publisher`, Beads `pspin-twk.13`, source version
`0.10.0-beta.17`. No deployment, installation, main-daemon access or restart was performed.

| Focused test file                                          | Passed | Output                                       |
| ---------------------------------------------------------- | -----: | -------------------------------------------- |
| `packages/share-worker/src/index.test.ts`                  |     18 | [Worker](publisher/worker-tests.txt)         |
| `packages/server/src/server/sharing/share-host.test.ts`    |      4 | [Host](publisher/host-tests.txt)             |
| `packages/server/src/server/sharing/share-service.test.ts` |     19 | [Service](publisher/service-tests.txt)       |
| `packages/server/src/server/sharing/sharing.e2e.test.ts`   |      5 | [Daemon e2e](publisher/e2e-tests.txt)        |
| `packages/server/src/server/config.test.ts`                |     12 | [Config](publisher/config-tests.txt)         |
| `packages/cli/src/commands/share.test.ts`                  |      4 | [CLI](publisher/cli-tests.txt)               |
| `packages/app/src/i18n/resources.test.ts`                  |     36 | [Nine locales](publisher/i18n-tests.txt)     |
| `scripts/ci-workflow.test.mjs` (Node)                      |      9 | [CI routing](publisher/ci-routing-tests.txt) |
| `packages/app/e2e/browser/conversation-sharing.spec.ts`    |      3 | [Browser](publisher/browser-tests.txt)       |

Vitest files used `npx vitest run <file> --bail=1`, with output redirected to individual
`/tmp/sharing-*-tests.txt` files. No full local suite ran. The Worker file also passes
through its own workspace script, matching the reused `relay-tests` CI job.

Observed in the isolated daemon harness with an HTTP fake Worker: create with no share listener;
redacted HTML/JSON equal stored artifacts; external URL construction; title and expiry republish;
failed PUT reports `share_publish_failed` with no extra record/artifacts; failed DELETE retains
local revocation and a durable pending job; the real one-minute timer retries successfully and
clears pending state. A second test proves publisher URL precedence with a working local listener.
Service tests cover pending delete-record recovery after restart with local artifacts already removed,
crash recovery before enqueue, all backoff
steps, host-config changes, failed metadata publication, and refusal to republish revoked shares.
Worker tests cover native Request handling, local-listener 404/body/security-header parity, expiry
metadata, TTL bounds, malformed bodies and 3 MiB rejection, authentication, methods and rate limits.

The browser spec ran from `packages/app` with
`TMPDIR="$PWD/../../artifacts/sharing-publisher/tmp" npm run test:e2e -- e2e/browser/conversation-sharing.spec.ts`.
At 1440px and 390px, it exercises preview → create → guest → revoke and older-host gating.
The real local daemon's share records are decorated on the browser socket with publisher metadata
and pending state to verify the external-host copy; the daemon e2e above proves actual host failure
and recovery. Screenshots were inspected: [desktop layout](publisher/revoke-pending-1440.png),
[compact layout](publisher/revoke-pending-390.png). Native iOS/Android and installed Electron were
not exercised. The harness stopped its own browser, worker daemon and Metro server.

Required checks passed: [build:server](publisher/build-server.txt),
[typecheck](publisher/typecheck.txt), [lint](publisher/lint.txt), [format](publisher/format.txt).
The final PR CI remains the full-suite authority. New workspace dependencies reuse the lockfile's
Wrangler 4.90.0 (npm publication: 2026-05-07T18:57:37.909Z) and existing Vitest; no resolved package
version changed. Live Cloudflare consistency, permissions and deployment remain operator checks;
[the deployment guide](../../../packages/share-worker/README.md) lists prerequisites.

## Phase 1 — earlier evidence

2026-10-24 · M4 macOS · branch `feat/conversation-sharing-phase1` · Beads `pspin-twk.2`.
The source version remains `0.10.0-beta.16`; the release owner owns the version bump.

## Automated evidence

Only the listed Vitest files were run locally, one at a time. Mock providers and isolated
homes/listeners supplied the test conversations. No full local workspace suite was run.

| Test file                                                   | Passed |
| ----------------------------------------------------------- | ------ |
| `packages/server/src/server/sharing/redaction.test.ts`      | 29     |
| `packages/server/src/server/sharing/share-service.test.ts`  | 9      |
| `packages/server/src/server/sharing/share-listener.test.ts` | 6      |
| `packages/server/src/server/sharing/sharing.e2e.test.ts`    | 2      |
| `packages/client/src/daemon-client.test.ts`                 | 146    |
| `packages/client/src/index.test.ts`                         | 19     |
| `packages/cli/src/commands/share.test.ts`                   | 3      |
| `packages/app/src/sharing/share-form-model.test.ts`         | 4      |
| `packages/server/src/server/config.test.ts`                 | 11     |
| `packages/app/src/i18n/resources.test.ts`                   | 36     |
| `packages/app/e2e/browser/conversation-sharing.spec.ts`     | 2      |

265 Vitest tests and two browser tests passed.

Each Vitest invocation used this form (replace `<file>` and `<name>` with the table entry):

```sh
npx vitest run <file> --bail=1 > /tmp/sol-sharing-<name>.txt 2>&1
```

Browser command, from `packages/app` (task-owned temporary fixtures on the external SSD):

```sh
TMPDIR="$PWD/../../artifacts/sharing-tmp" npx playwright test --project=browser e2e/browser/conversation-sharing.spec.ts
```

Observed: at 1440px and 390px, open Share from the header menu; see the server's redacted
preview; create a link; see the Shared badge; open the guest page with no pairing; render in
light and dark mode; revoke and receive 404; see the badge clear. Reconnect with the feature
flag false: no Share action, and the update-host message appears. The harness stopped its
worker daemon, browser and Metro server after verification.

Build/check commands:

```sh
npm run build:server
npm run typecheck
npm run lint
npm run format
```

All completed successfully. Protocol validation was regenerated by `build:server`.
No dependencies changed; the renderer reuses the server/app's existing `markdown-it@10.0.0`.

## Screenshots

The captures use the app's existing theme and components, and a guest page following the
product design guide. Only synthetic conversation text and fake credentials appear.

| Surface              | Wide                           | Compact                      |
| -------------------- | ------------------------------ | ---------------------------- |
| Share dialog / sheet | [1440px](share-sheet-1440.png) | [390px](share-sheet-390.png) |
| Guest, light         | [1440px](guest-light-1440.png) | [390px](guest-light-390.png) |
| Guest, dark          | [1440px](guest-dark-1440.png)  | [390px](guest-dark-390.png)  |

## Coverage limits

Web Chromium on macOS was exercised. Compact web coverage is not a physical iOS or Android
share-sheet test. Packaged Electron, Windows and Linux were not launched locally. Prepared-build
acceptance checks 21–22 remain with the release owner. No main daemon, installed app, or public
listener was changed. Fable's PR review is separate from these implementation checks.

## Raw targeted summaries

`packages/server/src/server/sharing/redaction.test.ts`

```text
 Test Files  1 passed (1)
      Tests  29 passed (29)
   Duration  184ms (transform 50ms, setup 0ms, import 101ms, tests 6ms, environment 0ms)
```

`packages/server/src/server/sharing/share-service.test.ts`

```text
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  175ms (transform 53ms, setup 0ms, import 82ms, tests 27ms, environment 0ms)
```

`packages/server/src/server/sharing/share-listener.test.ts`

```text
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  468ms (transform 58ms, setup 0ms, import 301ms, tests 93ms, environment 0ms)
```

`packages/server/src/server/sharing/sharing.e2e.test.ts`

```text
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  6.39s (transform 4.76s, setup 0ms, import 5.90s, tests 408ms, environment 0ms)
```

`packages/client/src/daemon-client.test.ts`

```text
 Test Files  1 passed (1)
      Tests  146 passed (146)
   Duration  4.11s (transform 2.99s, setup 0ms, import 3.38s, tests 648ms, environment 0ms)
```

`packages/client/src/index.test.ts`

```text
 Test Files  1 passed (1)
      Tests  19 passed (19)
   Duration  4.51s (transform 3.13s, setup 0ms, import 3.52s, tests 908ms, environment 0ms)
```

`packages/cli/src/commands/share.test.ts`

```text
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  5.10s (transform 4.05s, setup 0ms, import 4.98s, tests 14ms, environment 0ms)
```

`packages/app/src/sharing/share-form-model.test.ts`

```text
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  4.20s (transform 3.61s, setup 0ms, import 4.07s, tests 59ms, environment 0ms)
```

`packages/server/src/server/config.test.ts`

```text
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Duration  490ms (transform 106ms, setup 0ms, import 156ms, tests 268ms, environment 0ms)
```

`packages/app/src/i18n/resources.test.ts`

```text
 Test Files  1 passed (1)
      Tests  36 passed (36)
   Duration  653ms (transform 260ms, setup 0ms, import 300ms, tests 289ms, environment 0ms)
```

```text
  ✓  2 [browser] › e2e/browser/conversation-sharing.spec.ts:29:3 › shares a previewed snapshot and gates older hosts at 390px (9.3s)
[e2e] Worker 0 daemon stopped
[e2e] Metro stopped

  2 passed (30.7s)
```
