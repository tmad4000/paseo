# Working on this fork

This is a fork of [getpaseo/paseo](https://github.com/getpaseo/paseo). It carries a
small number of local changes on top of an upstream release, and it is built and
installed as a separate app (`Paseo Fork.app`, CLI `paseo-fork`) that runs beside a
stock Paseo rather than replacing it.

## Branch model

Upstream contribution branches start from an upstream release tag. Fork maintenance and
release integration branches start from canonical `tmad4000/paseo` main so they retain
newer fork behavior and selective upstream fixes.

| Branch          | Base                         | Contents                                                                                | Goes upstream? |
| --------------- | ---------------------------- | --------------------------------------------------------------------------------------- | -------------- |
| `main`          | upstream tag + fork features | **The canonical branch.** What gets built, installed, and cut to TestFlight.            | no             |
| `feat/<name>`   | upstream tag                 | One self-contained feature. One per PR.                                                 | **yes**        |
| `fork/branding` | upstream tag                 | Fork identity: app name, icon, `paseo-fork` CLI and URL scheme, FORK badge.             | **never**      |
| `jacob/daily`   | retired 2026-09-28           | Retired integration branch; do not build it. Feature parity is tracked in the register. | no             |

### Why it is shaped this way

A feature branch has to be reviewable by upstream in isolation, so it may only
contain that feature. The branding is the opposite: it renames the app and the
CLI, so it must never reach an upstream PR. Keeping them apart means `main` can
carry both while each feature stays independently submittable.

`main` is a merge, not a rebase. Merging keeps each feature branch's identity
stable, so a branch that has already been pushed for review is not rewritten
every time `main` is refreshed.

There used to be two integration lineages: `main` (where PRs landed) and
`jacob/daily` (what the daemons and desktop were built from). Features merged to
one never ran on the other, which is how "Update the host to use Stream" appeared
on a phone built from `main` against a daemon built from `daily`. One branch is
built and one branch is targeted, and both are `main`.

### Upstream wins

When upstream ships something a fork feature was for, take upstream's and delete
ours; the fork augments upstream, it never keeps a rival implementation alive
behind a flag. Chat find is the worked example: the fork's search scaffold and
its `agent.timeline.search` schema were dropped for upstream's, and only the
native wrapper (`packages/app/src/agent-stream/chat-find/index.tsx`) is fork
code. Use the feature register to verify that the upstream replacement preserves the intended behavior;
record deliberate behavior changes and unresolved gaps in the integration PR.

## Feature preservation

The [fork feature register](docs/fork-features.md) is the maintained record of intended fork
behavior, source status, regressions, and pending work. Update it with feature PRs. Read it before
an upstream update, lineage reconciliation, or fork release, and attach its preservation matrix
and installed-build smoke receipt as applicable. Historical merges do not prove feature parity.

## Rules

- **Land on `main` through a PR from a feature branch.** A commit made only on
  the integration branch cannot be sent upstream in isolation.
- **One feature, one branch, one PR.** If a change needs the branding to work, it
  belongs in `fork/branding`, not in the feature.
- **Anything that hardcodes the name "Paseo" is a branding concern.** Bundle
  names, CLI shims, URL schemes, and app-discovery paths have all bitten this
  fork before. Resolve by shape where possible rather than by literal name.

## Build and install

Record the candidate and feature dispositions using the [preservation workflow](docs/fork-features.md#reviewing-an-upstream-update-or-reconciliation).
After an authorized install, complete the [installed-build smoke receipt](docs/fork-features.md#installed-build-smoke-receipt)
before reporting the rollout verified. This applies to private hotfixes and betas as well as stable builds.

```bash
git checkout main
npm install                  # after any upstream bump — dist/ goes stale across versions
npm run build                # builds all packages, then signs and packages the desktop app
```

The always-on daemon on the M4 runs from the checkout that `~/.npm-global/bin/paseo`
points at (see `~/Library/LaunchAgents/sh.paseo.daemon.plist`). After a `main`
update, rebuild that checkout on `main` and restart the daemon; a daemon built from
any other branch will not carry the fork features the app expects.

The desktop branding (app id, product and executable name, `paseo-fork://` scheme,
icons, artifact names, updater feed) lives in `packages/desktop/electron-builder.fork.cjs`,
which this package's `build` script uses. `packages/desktop/electron-builder.yml`
stays byte-for-byte upstream's: upstream's packaging scripts and CI smoke jobs are
welded to the literal `Paseo` identity (Linux launcher rename, `/opt/Paseo`,
`Paseo.desktop`, `dpkg --remove paseo`), so the branded config must never be what
they extend.

The signed bundle lands at `packages/desktop/release/mac-arm64/Paseo Fork.app`,
with a `.dmg` and `.zip` beside it.

Install it, replacing any previous copy — `ditto` into an existing bundle merges
directories and breaks the code signature, so remove first:

```bash
paseo-fork daemon stop
/bin/rm -rf "/Applications/Paseo Fork.app"
ditto "packages/desktop/release/mac-arm64/Paseo Fork.app" "/Applications/Paseo Fork.app"
codesign --verify --deep --strict "/Applications/Paseo Fork.app"   # must exit 0
ln -sf "/Applications/Paseo Fork.app/Contents/Resources/bin/paseo-fork" ~/.local/bin/paseo-fork
paseo-fork daemon start
```

The fork uses the same `~/.paseo` home and port `6767` as stock Paseo, so only one
of the two can run at a time. That is deliberate: the fork is the daily driver and
sees the real agent history.

## iOS (TestFlight)

The mobile app carries its own identity so it installs beside stock Paseo and does
not touch upstream's App Store Connect app or getpaseo EAS project:

|                        | Fork                            | Upstream                  |
| ---------------------- | ------------------------------- | ------------------------- |
| On-device app name     | `Paseo Fork`                    | Paseo                     |
| App Store listing name | `Paseo Fork by Ideaflow`        | Paseo                     |
| iOS bundle id          | `io.ideaflow.paseo-fork`        | `sh.paseo`                |
| Android application id | `io.ideaflow.paseofork`         | `sh.paseo`                |
| ASC app id / SKU       | `6813662768` / `paseo-fork-ios` | `6758887924`              |
| EAS owner / projectId  | none (local build)              | `getpaseo` / `0e7f65ce-…` |

Android application ids may not contain hyphens, so the two ids diverge on
purpose. The App Store listing name has to be globally distinct, so it is longer
than the home-screen name — the on-device `Paseo Fork` (CFBundleDisplayName) and
the store's `Paseo Fork by Ideaflow` are allowed to differ. Identity lives in
`packages/app/app.config.js` (`variants`); the ASC app id lives in
`packages/app/eas.json` and defaults into the release script.

The fork ships iOS **locally**, not through EAS, under the IdeaFlow Apple team
(`JESMXK96LG`) — see `packages/app/scripts/testflight-fork.sh`. The App Store
Connect app record already exists, so no Apple web step remains:

```bash
packages/app/scripts/testflight-fork.sh            # archive + export .ipa
packages/app/scripts/testflight-fork.sh --upload   # + upload to TestFlight
```

Signing/notary material (distribution cert, ASC key `KWJX4896S5`, issuer id) is
documented in `~/.claude/rules/ios-deploy.md`.

Builds run on the M3 build server (`ssh m3`) from `~/code/paseo-fork` on `main`.
Over SSH the login keychain is locked and codesign fails, so unlock it for the
session first (`security unlock-keychain` with the password in
`~/.config/m3-login.txt`) and keep it unlocked for the length of the archive.
Each upload needs a CFBundleVersion App Store Connect has not seen; it derives
from the `packages/app/package.json` version (`packages/app/native-release-version.js`),
so bump the version before cutting a second build from the same release.

## Adding a feature

```bash
git fetch upstream --tags
git checkout -b feat/<name> v0.10.0-beta.1 # branch from the release tag, not from a fork branch
# ...build the feature, with tests...
git push -u origin feat/<name>             # open a PR against main
npm run build                              # then install as above once it lands
```

Before merging, confirm the branch is clean against upstream:

```bash
git diff --name-only v0.10.0-beta.1..feat/<name>   # should list only your feature's files
```

## Submitting a feature upstream

```bash
git push origin feat/<name>
gh pr create --repo getpaseo/paseo --head tmad4000:feat/<name> --base main
```

The branch is already based on an upstream tag and contains nothing else, so it
applies cleanly. Do not include `fork/branding` in the PR.

## Moving to a newer upstream release

First read the feature register from both the previous fork and the candidate, then complete its
[preservation matrix](docs/fork-features.md#reviewing-an-upstream-update-or-reconciliation).
Keep this step and its register when resolving documentation conflicts.

Select an upstream **release tag**, verify its publication time and peeled commit, and audit
all newly adopted commits and locked external dependencies against the authorized age cutoff.
A release date alone does not establish dependency age. Record the original fork SHA and
selected tag SHA before applying source; never replace the selected release with upstream main.

```bash
git fetch upstream --tags
git switch -c integrate/upstream-<release> origin/main
# Only for lineages with a usable ancestry merge:
git merge --no-commit --no-ff v<eligible-release>
```

Inspect ancestry first. The fork's rebuilt v0.10 snapshot and subsequent selective sync do not
share a useful recent merge base with upstream. In that lineage, reconcile the release delta
from the documented snapshot tag, then account for every behavior against the selected final
tag and newer fork equivalents. Patch trailers and historical cherry-picks alone do not prove
current parity. Do not record an ancestry-only merge as evidence that missing behaviors exist.

Resolve the coherent batch before committing. Use the frozen lock in the task's isolated
checkout (`npm ci`), rebuild workspace declarations, run lint/typecheck/build and the authorized
test coverage, and obtain independent review. Keep product versions and fork branding separate
from any explicitly maintained bundled API baseline. Open a PR to canonical main with the
complete register matrix, included/excluded commits, age evidence, failures and rollback plan.
A source integration PR does not authorize publishing, installation or daemon/session restart.

Two things reliably break on an upstream bump and are worth checking first:

- **Stale `dist/`.** Cross-package type errors after a version jump are almost
  always stale workspace builds, not real errors. Rebuild `@getpaseo/protocol`,
  `@getpaseo/relay`, and `@getpaseo/client` before reading any of them.
- **Stale `node_modules`.** `patch-package` failures on the React Native packages
  mean the tree predates the new lockfile. Delete the offending package directory
  and reinstall rather than regenerating the patch file.

New locales are the other recurring surprise: upstream adds a language, and every
feature that introduced an i18n key fails to typecheck until that key is added to
the new file.
