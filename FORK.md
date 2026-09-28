# Working on this fork

This is a fork of [getpaseo/paseo](https://github.com/getpaseo/paseo). It carries a
small number of local changes on top of an upstream release, and it is built and
installed as a separate app (`Paseo Fork.app`, CLI `paseo-fork`) that runs beside a
stock Paseo rather than replacing it.

## Branch model

Every branch starts from an upstream release tag, never from another fork branch.

| Branch          | Base                         | Contents                                                                        | Goes upstream? |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------- | -------------- |
| `main`          | upstream tag + fork features | **The canonical branch.** What gets built, installed, and cut to TestFlight.    | no             |
| `feat/<name>`   | upstream tag                 | One self-contained feature. One per PR.                                         | **yes**        |
| `fork/branding` | upstream tag                 | Fork identity: app name, icon, `paseo-fork` CLI and URL scheme, FORK badge.     | **never**      |
| `jacob/daily`   | retired 2026-09-28           | Former integration branch. Everything it carried is on `main`; do not build it. | no             |

Current feature branches:

- `feat/artifact-feed` — per-chat artifact feed (see [NOTES.md](NOTES.md))

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
code. Ambiguous cases resolve to upstream.

## Rules

- **Land on `main` through a PR from a feature branch.** A commit made only on
  the integration branch cannot be sent upstream in isolation.
- **One feature, one branch, one PR.** If a change needs the branding to work, it
  belongs in `fork/branding`, not in the feature.
- **Anything that hardcodes the name "Paseo" is a branding concern.** Bundle
  names, CLI shims, URL schemes, and app-discovery paths have all bitten this
  fork before. Resolve by shape where possible rather than by literal name.

## Build and install

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

```bash
git fetch upstream --tags
git rebase --onto v<new> v<old> feat/<name>     # repeat per feature branch
git rebase --onto v<new> v<old> fork/branding
git checkout main && git merge --no-ff upstream/main    # then merge each rebased branch
npm install && npm run build
```

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
