# Stream message inventory QA

Synthetic browser fixtures exercise the actual app and an isolated daemon. Screenshots use
existing theme tokens at 390px and 1440px; no real conversation contents are published.

- [Phone: filter-empty with count and reset](stream-filter-empty-phone.png)
- [Desktop: all activity](stream-activity-desktop.png)
- [Checklist: independently tracked asks from one message](stream-multiple-asks.png)

Focused results on 2026-10-07:

```text
server/stream-message-inventory.test.ts       3 passed
server/agent-manager.test.ts (coverage)      1 passed, 208 skipped
protocol/agent-deep-link.test.ts             4 passed
desktop/agent-navigation.test.ts             4 passed
app/stores/agent-view-store.test.ts          2 passed
app/chat-outline/use-chat-outline.test.tsx  7 existing passed + 1 new passed
browser/global-stream.spec.ts               5 cases passed across focused runs
npm run lint                                0 warnings, 0 errors
npm run typecheck                           all workspaces passed
npm run format                              passed
```

The final two new browser cases passed again after header-density refinement: 2 passed (1.3m).
The older-history pagination/reopen test passed after explicitly returning to Checklist/Open on
reload, because Activity now intentionally defaults to all captured activity. Its pagination,
evidence and reopen assertions remain. The initial PR #57 CI virtualization failure was repaired
separately; its final run37726622383 passed13 checks with6 skips at4eebe5136e80c1e89c7ad458edaeb0ecadcbd087.

Storage coverage includes63 source messages across fresh manager instances and50+13 pages,
failed storage acknowledgement/retry, repeated identical messages, source-position refresh,
independent multi-ask review/completion, stale revision rejection and source-review reopen.
The closed-item regression fixture matches8 outcomes plus2resolved permissions:0open,10other.
Role filtering excludes assistant questions from user messages. Clipboard, host/session Stream
links, routing/reload, and opening a source in Chat were exercised in the browser.

Desktop/native link parser and desktop renderer-queue behavior have unit coverage. Actual native
and packaged Electron acceptance, real authentication-return acceptance, and combined installed
pinning/voice QA remain release handoff work. PR #58 owns session favorites; this feature persists
Chat/Stream selection across reload, superseding the older reset behavior described by that PR.
No installed app, shared daemon or voice process was changed by these tests.

The message inventory is automatic coverage of retained messages, not guaranteed semantic ask
extraction. Existing agents must review each message and register its separate asks. Historical
provider data remains untouched; missing/pruned records are not claimed recoverable. See
[companion-stream.md](../companion-stream.md) for the exact contract and limits.
