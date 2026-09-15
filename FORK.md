# Working on this fork

This is a fork of [getpaseo/paseo](https://github.com/getpaseo/paseo). It carries a
small number of local changes on top of an upstream release, and it is built and
installed as a separate app (`Paseo Fork.app`, CLI `paseo-fork`) that runs beside a
stock Paseo rather than replacing it.

## Branch model

Every branch starts from an upstream release tag, never from another fork branch.

| Branch          | Base                       | Contents                                                                    | Goes upstream? |
| --------------- | -------------------------- | --------------------------------------------------------------------------- | -------------- |
| `main`          | —                          | Stale pre-0.4.0 history. Kept for reference only.                           | no             |
| `feat/<name>`   | upstream tag               | One self-contained feature. One per PR.                                     | **yes**        |
| `fork/branding` | upstream tag               | Fork identity: app name, icon, `paseo-fork` CLI and URL scheme, FORK badge. | **never**      |
| `jacob/daily`   | `feat/*` + `fork/branding` | The integration branch. This is what gets built and installed.              | no             |

Current feature branches:

- `feat/artifact-feed` — per-chat artifact feed (see [NOTES.md](NOTES.md))

### Why it is shaped this way

A feature branch has to be reviewable by upstream in isolation, so it may only
contain that feature. The branding is the opposite: it renames the app and the
CLI, so it must never reach an upstream PR. Keeping them apart means the daily
build can carry both while each feature stays independently submittable.

`jacob/daily` is a merge, not a rebase. Merging keeps each feature branch's
identity stable, so a branch that has already been pushed for review is not
rewritten every time the daily build is refreshed.

## Rules

- **Never commit to `jacob/daily` directly.** Commit to a feature branch or to
  `fork/branding`, then merge. A commit made only on the integration branch
  cannot be sent upstream and will be lost on the next rebase.
- **One feature, one branch, one PR.** If a change needs the branding to work, it
  belongs in `fork/branding`, not in the feature.
- **Anything that hardcodes the name "Paseo" is a branding concern.** Bundle
  names, CLI shims, URL schemes, and app-discovery paths have all bitten this
  fork before. Resolve by shape where possible rather than by literal name.

## Build and install

```bash
git checkout jacob/daily
npm install                  # after any upstream bump — dist/ goes stale across versions
npm run build                # builds all packages, then signs and packages the desktop app
```

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

## Adding a feature

```bash
git fetch upstream --tags
git checkout -b feat/<name> v0.4.0        # branch from the release tag, not from a fork branch
# ...build the feature, with tests...
git checkout jacob/daily
git merge --no-ff feat/<name>
npm run build                              # then install as above
```

Before merging, confirm the branch is clean against upstream:

```bash
git diff --name-only v0.4.0..feat/<name>   # should list only your feature's files
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
git branch -f jacob/daily feat/<first>
git checkout jacob/daily && git merge --no-ff <each other branch>
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
