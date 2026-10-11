# Sidebar filter

The find field at the top of the left sidebar is the one field for finding a chat or starting one.
It filters live as you type, and Enter starts a new chat with the text. Find with AI (Mod+Enter) is
the intelligent Find, a different feature with its own contract: [session routing](session-routing.md).

The filter answers "where is the thing I'm thinking of" in three tiers, shallowest first. Each tier
says why a row is there, so a workspace you did not expect in the list explains itself.

| Tier        | Matches                                              | Where it renders                              | Cost                                     |
| ----------- | ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| Tree        | Project name, workspace title or name, any tab title | The normal Project → Workspace tree, filtered | Client-side, every keystroke, no network |
| Tab titles  | Agent session titles in that workspace               | Compact rows nested under the workspace row   | Same pass as the tree                    |
| In messages | User and assistant message text                      | A group below the tree, newest first          | Daemon RPC, debounced, bounded           |

The empty state appears only when the tree is empty and the message tier has finished with
nothing; it then carries Start a chat as its primary button.

## One field (2026-10-11)

The field used to have two modes with their own text fields: Find (search only) and Send prompt (a
second prompt field plus a picker with a third search field). Both start from the same sentence,
and whether to find or to act depends on whether a matching chat already exists, which the live
filter already answers. So there is one field, and a few compact rows directly under it say what
each key does with the text:

```
[🔍 relay reconnect           ✕] [➤] [⚲] [⇅]
  New chat "relay reconnect"           ↵
  Find with AI                ⌘↵  All projects ▾
  Send to best match
  …live results: workspaces, tab titles (each with Send), messages
```

- **Enter starts a new chat** with the text, through Quick launch (prefill only; nothing is created
  until Quick launch starts it).
- **A pasted session id** that names exactly one chat adds **Open <title>** above it and takes
  Enter, so Enter never surprises: the row that owns Enter shows the ↵. "Exactly one" counts only
  the tab rows the filter is showing (same hosts, project and label filters, and tab rules), so
  Open never names a chat the list hides (`pickUniqueSessionIdMatch` in `find-or-start.ts`).
- **Send** on a matched tab row, or the ➤ button beside the field, enters the send state with the
  text carried into an empty prompt (a saved prompt is kept, never overwritten). Send appears only
  on chats that can be destinations (not child chats), and choosing one widens a Find-with-AI
  project scope to All projects rather than refusing it. It is the old Send prompt mode (recipient, Queue/Steer/Interrupt,
  New conversation, Route to best match) with a single text field; its picker lists recent chats
  without a search field of its own. **Back to search** returns to the field.
- **Find with AI** keeps the scope menu (All projects / a project) in its row, the only place scope
  changes results. "Use this chat" on its results carries the text like Send does. **Send to best
  match** appears when a host supports routing; if a different prompt is already saved, it shows
  that prompt instead of routing it, so the row never sends text other than what it sits under.

Before and after screenshots: [`find-or-start/`](find-or-start/) (`before-find.png`,
`before-send.png`, `after-typing.png`, `after-session-id.png`, `after-send.png`).

While the routing draft loads or a delivery is pending, Find with AI, Send to best match, ➤ and
the tab rows' Send stay visible but disabled, so the field does not jump; Enter, Open and New chat
never touch the routing draft and stay available. The composer exposes `findWithAi`, `clear`,
`enterSend` and `locked` to the field through its render function (`FindFieldActions` in
`session-routing/composer.tsx`). The tab rows and the Mod+Enter handler reach it through
`useRoutingBridge` (`find-or-start.ts`), which also lists routable chats and clears only its own
registration.

## Keys and scope

| Key / control              | Does                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Typing                     | Live filter (all tiers in the current scope)                                                                                   |
| Enter, or the New chat row | Open Quick launch with the query as the prompt; opens the chat instead when the text is a session id matching exactly one chat |
| Mod+Enter, or the row      | Find with AI (intelligent Find)                                                                                                |
| Mod+Shift+Enter            | Quick launch with Start and open preselected                                                                                   |
| Send (row or ➤)            | Send state: the text becomes the prompt for a chosen chat                                                                      |
| Scope menu (filter icon)   | **Names** (tree and tab titles) or **Names + messages** (default)                                                              |

The scope is per device (`filterScope` in the sidebar view store). When no host in the sidebar
advertises `sessionTextSearch`, the Names + messages item says that messages need a host update; the
choice is kept and takes effect once a host updates.

Starting a chat goes through one function, `startChatFromFilterQuery`
(`packages/app/src/components/sidebar/find-to-prompt.ts`, bound to the app by
`use-start-chat-from-filter-query.ts`). It opens [Quick launch](quick-launch.md) with the query as
the prompt and no destination, so Quick launch's Default-project resolver picks where it goes and
the person confirms in the dialog. The filter, Send → New conversation, and Quick launch share that
one creation path.

The command center offers **Search messages for "<q>"** when a query of three or more characters
matches no command and no workspace. It opens the sidebar (if collapsed), switches the scope to
Names + messages, and puts the query in this field with focus. It searches nothing itself.

## Tree and tab titles

A workspace stays in the tree when its own names match or when any of its tab titles do. The tab
matches render under the workspace row (provider icon, title, matched text emphasized), three at a
time with "+N more". A tab named exactly like its workspace is not repeated under it. Clicking a
nested row opens that tab.

Tab titles come from the agent directory the client already holds (`session.agents` per host),
so this tier never touches the network. Only tabs a workspace can show count: unarchived, titled,
and a workspace root or explicitly auto-opened. Child agents live inside their parent's tab.
Terminal titles are not matched; they are fetched per workspace and are not held globally.

Two things keep typing cheap, and both are easy to undo by accident:

- The directory is subscribed only while a query is active, and the match result keeps its
  previous identity when only statuses changed (`areSidebarTabMatchesEqual`). Without that, every
  running agent's status update recomputes the filtered tree.
- Tab matches and message hits live in their own contexts (`sidebar-filter-context.tsx`), not on
  the sidebar model, so a keystroke or a late response re-renders the rows that read them rather
  than every model consumer.

Model: `packages/app/src/components/sidebar/sidebar-filter-matches.ts`. Rows:
`packages/app/src/components/sidebar/sidebar-filter-results.tsx`.

A query shaped like a session id (hex with dashes, containing a digit, at least six characters)
also matches tabs by id prefix, so pasting `9b8394eb` or a full id shows that session's tab. The
same rule (`protocol/src/search/session-id.ts`) answers Cmd+K, the field's Open row (exactly one
match), and Find with AI, where the daemon returns the id match directly instead of asking the
ranking model.

## In messages

After 300 ms without typing and at least three characters, the app sends
`session.text_search.request` to each host in scope that advertises
`server_info.features.sessionTextSearch`. Scope is the sidebar's workspaces after the project and
label filters, before the text query. Hosts without the feature are skipped silently; the tier is
best-effort and never shows an error.

The daemon side (`packages/server/src/server/session-text-search.ts`) is a lexical scan, never a
model call, because it runs on every pause in typing. Its bounds are the contract:

| Bound              | Value                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Sessions read      | 200 most recently active                                                                                |
| Window per session | Loaded: last 400 timeline rows. Unloaded: last 1 MiB of the transcript, ≤ 400 messages of ≤ 8,000 chars |
| Hits per session   | 3, newest first                                                                                         |
| Hits per response  | 50                                                                                                      |
| Time budget        | 1 s, then returns what it has with `truncated`                                                          |
| Snippet            | ≤ 160 characters, centered on the match                                                                 |

Where the text comes from matters more than the scan. The daemon's timeline only holds agents
opened since it started, and agent records hold no messages, so a search over the timeline alone
misses most chats after a restart. Unloaded agents are read from the provider transcript their
record's `persistence` handle names (`session-text-history.ts`), opened read-only. They are never
resumed, because resuming spawns the provider and registers the agent.

| Provider | Transcript read                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Claude   | `$CLAUDE_CONFIG_DIR` or `~/.claude`, `projects/<encoded cwd>/<sessionId>.jsonl`                          |
| Codex    | `$CODEX_HOME` or `~/.codex`, `sessions/YYYY/MM/DD` and `archived_sessions`, `rollout-*-<threadId>.jsonl` |
| Others   | Searched only while loaded (OpenCode, ACP agents such as Gemini, Pi)                                     |

Only typed text counts: tool results, thinking, sidechains, and Codex's injected AGENTS.md and
environment blocks are skipped. Parsed transcripts are cached per agent and activity stamp
(`lastActivityAt|updatedAt`), so keystrokes reuse them. The cache is evicted oldest-first past
16 M characters. When a bound stops the scan, the group ends with "Searched N of M chats".

Matching is NFKC-normalized, whitespace-collapsed, case-insensitive substring. Exclusions match
intelligent Find: archived sessions, archived workspaces and projects, internal agents, and child
agents. A newer request on the same connection aborts the older scan, which still answers with an
error so its caller settles.

Clicking a hit opens that tab. Scrolling to the matching message is not wired: chat find has no
deep-link entry point yet, and the hit carries `seq` for when it does.
