# Threaded replies

"Reply in thread" on an assistant reply starts a side conversation about that reply. The main chat
is not touched: the thread is a separate session that carries the chat up to that reply, opened
beside it. Slack-style, the reply then shows **N replies**, which reopens the thread.

## Using it

- **Reply in thread** (the speech-bubble arrow next to Fork at the end of a completed reply) opens a
  new chat beside the main one, with the conversation up to that reply attached as chat history.
  Focus moves to the thread's composer; the main chat keeps its route, scroll and draft.
- The thread's first message creates its session, linked to the reply it answers.
- **N replies** under the reply opens the thread beside the main chat (a menu when there are
  several). Closing a thread's tab only hides it; archive it like any session to remove it.
- In the thread, **Main thread** reveals the main chat, and **Send to main** queues the thread's
  latest answer in the main chat as a quoted message, with the thread's title and session id. It is
  queued, not interrupting: the main agent reads it after its current turn. It needs a host with
  the message queue, a finished answer in the thread, and a main chat that still exists.

## How it works

- **Context** reuses Fork's chat-history draft (`buildAgentForkContext` → a `chat_history`
  attachment up to the reply's boundary), so it works the same for every provider. No provider
  session is forked and the main session's provider state is never rewritten (unlike Rewind,
  which forks the Claude session in place).
- **Link**: the thread session is created with two labels, `paseo.thread-parent` (the main
  session's agent id) and `paseo.thread-anchor` (the reply's message id, or `cursor:<epoch>:<seq>`
  when the provider gives none). Until the first message, the link lives with the draft's
  attachment in memory (`threads/draft-store.ts`), not on the persisted tab target, so saved
  layouts stay readable by older builds. Threads deliberately do not use `paseo.parent-agent-id`:
  that is daemon-owned parentage with ownership, notification and archive semantics.
- **Placement**: a thread opens in the layout that shows its main chat (for a session shown in a
  split from another workspace, that layout's workspace). It is not auto-opened as a tab on other
  clients (`agent-visibility.ts`), and closing its tab is layout-only (`close-tab-policy.ts`).
- **Moving sessions** (code-k9i "Move to project…"): the link names agents, not workspaces, so a
  moved main chat or thread keeps its replies; a thread living in another workspace opens beside
  the main chat as a pinned split session.
- Client-only: the labels ride the existing `createAgent` request, so older hosts work unchanged
  (Send to main needs `agentMessageQueue`).

Code: `packages/app/src/threads/`, wired in `agent-stream/turn-footer.tsx` (controls),
`hooks/use-fork-agent.ts` (the `thread` fork target), `composer/draft/workspace-tab.tsx` (labels
at creation) and `panels/agent-panel.tsx` (host and Main thread / Send to main).

## Not yet

- Threads on user messages (only completed assistant replies have a fork boundary today).
- Native provider forks (Claude `forkSession`) for full tool-state fidelity instead of a chat
  history attachment.
- Listing threads in the subthreads drawer beside subagents.
