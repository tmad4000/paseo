# Sidebar filter

The find field at the top of the left sidebar filters live as you type. Enter runs intelligent
Find instead, which is a different feature with its own contract: [session routing](session-routing.md).

The filter answers "where is the thing I'm thinking of" in three tiers, shallowest first. Each tier
says why a row is there, so a workspace you did not expect in the list explains itself.

| Tier        | Matches                                              | Where it renders                              | Cost                                     |
| ----------- | ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| Tree        | Project name, workspace title or name, any tab title | The normal Project → Workspace tree, filtered | Client-side, every keystroke, no network |
| Tab titles  | Agent session titles in that workspace               | Compact rows nested under the workspace row   | Same pass as the tree                    |
| In messages | User and assistant message text                      | A group below the tree, newest first          | Daemon RPC, debounced, bounded           |

Then a muted "Press Enter for intelligent Find" line. The empty state appears only when the tree is
empty and the message tier has finished with nothing.

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

## In messages

After 300 ms without typing and at least three characters, the app sends
`session.text_search.request` to each host in scope that advertises
`server_info.features.sessionTextSearch`. Scope is the sidebar's workspaces after the project and
label filters, before the text query. Hosts without the feature are skipped silently; the tier is
best-effort and never shows an error.

The daemon side (`packages/server/src/server/session-text-search.ts`) is a lexical scan, never a
model call, because it runs on every pause in typing. Its bounds are the contract:

| Bound              | Value                                               |
| ------------------ | --------------------------------------------------- |
| Sessions read      | 200 most recently active                            |
| Window per session | Last 400 projected timeline rows (shared with Find) |
| Hits per session   | 3, newest first                                     |
| Hits per response  | 50                                                  |
| Time budget        | 1 s, then returns what it has with `truncated`      |
| Snippet            | ≤ 160 characters, centered on the match             |

Matching is NFKC-normalized, whitespace-collapsed, case-insensitive substring. Exclusions match
intelligent Find: archived sessions, archived workspaces and projects, internal agents, and child
agents. A newer request on the same connection aborts the older scan, which still answers with an
error so its caller settles.

Clicking a hit opens that tab. Scrolling to the matching message is not wired: chat find has no
deep-link entry point yet, and the hit carries `seq` for when it does.
