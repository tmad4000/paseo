# Eligible workspace tab search QA

Base: a79cf103 (eligible a7 + compact217 + cards218). This is a minimal PR211 feature adaptation, not canonical-main adoption. Canonical reference head0b515ef was reviewed and merged as3eca959a; its actual merge tree equals the tested synthetic tree. The sealed source bundle was verified with a trusted bounded hash reader (358 payloads; manifest13dc85b4). Imported verification code was not executed.

## Scope

The approved 59-path allowlist retains eligible Tooltip/Pressable wrappers and language dictionaries. No IconTooltip audit, Move-chat, unrelated session links, dependency/lock/version, model/server/protocol/provider/desktop-native or workflow changes. Canonical screenshots are reference evidence only. The compact217 and card218 production blobs remain byte-identical to the eligible base.

## Derived checks

- Actual eligible shortcut-registry baseline fails the new workspace tab-search action assertion; the restored port passes.
- 318 focused unit cases passed across 13 relevant files, including keyboard/overrides, combobox behavior, settings, workspace search/selection/Explorer models, overlay document lifetime and compact geometry.
- 33 real-browser cases passed: ten overlay focus regressions and the existing 23 card/form cases, in sandboxed system Chrome.
- Three genuine pointer-drag/clipboard cases passed on option label, description and unrelated text. Trusted mouse/selection events, exact selected/copied strings, unchanged option/submission and ordinary click/Enter behavior are verified. The temporary harness was archived; card production and test files remain unchanged.
- Fourteen isolated full-app Playwright flows passed with retries disabled: compact composer resize/draft preservation; existing tab activity/read semantics/order; title clearance at hover/keyboard focus; desktop/compact search and existing-pane draft preservation; hidden Explorer presentation without moving tabs or A-B-A resurrection; desktop/compact footer query handoff; nested compact Rename input/Escape ownership.
- App typecheck and repository lint passed. Final formatting and required commit-hook full typecheck results are bound to the final source receipt.

Tests used synthetic GCP fixtures and existing eligible dependency builds whose source trees were checked identical. No real provider sessions or installed app were exercised. The isolated fixture daemons and Metro stopped at teardown.

## Retained limits

Canonical PR CI had eleven applicable successes and eight path skips, with four automatic browser retry passes and unknown causes retained honestly. This is canonical history, not derived-source CI proof. Its earlier full local AST-scan timeout remains historical; no broad local suite or canonical pipeline rerun was requested or performed here. The first downstream Playwright invocation used a variadic CLI project argument incorrectly and executed no tests; corrected argument syntax ran the fourteen flows without retries or assertion changes.

Move-chat/195/205 and unrelated features remain excluded. Shared keyboard/focus compatibility is checked on existing Rename and generic modal/inline targets, not an absent Move feature. macOS/iOS/Android, native packages, actual installed client and updater downloaded-ready acceptance are unverified by these Linux tests.

Derived immutable head/tree/parent, patch, before-images, dependency proof, test logs and independent root review are separate release intake requirements. No native build/export, version/tag/feed publication, GUI operation, installation or shared daemon/provider restart is authorized by this QA note.
