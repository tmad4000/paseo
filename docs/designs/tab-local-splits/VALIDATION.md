# Validation — 2026-10-29

- JavaScript syntax: `node --check` passed.
- Interaction logic exercised with a minimal DOM stub: initial split, nested split, Escape cancellation, independent tab layout/focus, four-view demo cap, undo, reset, coexistence and preference behavior passed. This does not establish browser rendering or native accessibility behavior.
- `git diff --check` passed.
- Preview HTTP 200 verified from M5 over the tailnet.
- Visual review unavailable: Chrome app automation timed out twice and the isolated browser provider was unavailable. Desktop/mobile rendering and screen-reader behavior remain unverified.
- Prototype intentionally does not implement drag resizing, real sessions, persistence or production compact view switching. See README for proposed behavior and implementation acceptance criteria.

Documentation-only publication: the repository-wide pre-commit typecheck could not run in this dependency-free worktree (missing tsgo/zod-aot). It was excluded for this docs-only commit; the existing formatter was used without installing dependencies. No application TypeScript changed.
