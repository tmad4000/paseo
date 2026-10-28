# Workspace describe

Fork feature `workspace-describe`. Lets an agent answer "what is the other tab in this session on?"
without reading `~/.paseo/agents/*/*.json` by hand.

A workspace is the tab group the app shows together. The daemon knows which agents belong to it,
but not which tab is focused or how the tabs are ordered on any client, so "the other tab" means
"the other non-archived agents in my workspace".

## Surfaces

| Surface                  | Shape                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP `list_agents`        | Each row gains optional `workspaceId` and `parentAgentId` (from the `paseo.parent-agent-id` label).                                                                      |
| MCP `describe_workspace` | `{ workspaceId?, excludeSelf? }` → `WorkspaceDescription`. `workspaceId` defaults to the caller's workspace.                                                             |
| WebSocket RPC            | `workspace.describe.request` `{ workspaceId, excludeAgentId? }` → `workspace.describe.response` `{ description, error }`. Permission: `workspace.read` or `hub.execute`. |
| CLI                      | `paseo workspace describe [workspace-id] [--exclude-self] [--json]`. Without an id it uses `PASEO_AGENT_ID`'s workspace.                                                 |
| CLI                      | `paseo ls --json` / `paseo agent ls --json` rows gain `workspaceId` and `parentAgentId`. The table is unchanged.                                                         |

All schemas live in `packages/protocol/src/messages.ts` (`WorkspaceDescriptionSchema` and friends).
The daemon logic is `packages/server/src/server/agent/workspace-describe.ts`; the summary builder is
`packages/protocol/src/workspace-focus.ts`.

## Result

```jsonc
{
  "workspaceId": "wks_…",
  "title": "Paseo fork",          // workspace display name, null if the record is gone
  "cwd": "/path/to/checkout",
  "generatedAt": "2026-10-27T…Z",
  "agents": [                      // non-archived, non-internal; oldest first
    {
      "id": "…", "title": "…", "provider": "claude", "model": "opus",
      "status": "idle", "createdAt": "…", "updatedAt": "…", "lastUserMessageAt": "…",
      "labels": { … }, "parentAgentId": null,
      "focus": {
        "firstUserMessage": "…",     // truncated to 280 chars
        "lastUserMessage": "…",      // 280
        "lastAssistantMessage": "…", // head, 320
        "summary": "Started with \"…\". Latest user message: \"…\". Last reply began: \"…\". Open asks: … [in_progress]. Pinned: \"…\"."
      },
      "openAsks": [{ "askId": "…", "text": "…", "state": "in_progress" }],
      "pins": [{ "entryId": "pin:…", "text": "…" }]
    }
  ]
}
```

`openAsks` and `pins` are `null` when the host cannot read Stream, and `[]` when there are none.
Open asks exclude `done` asks and read-only mirrors of canonical tasks.

## The focus summary is derived, not generated

No model call. The same inputs give the same paragraph, so it is cheap to call from any agent and safe
to diff. Inputs, in order: first user message, latest user message (omitted when it equals the
first), head of the last assistant reply, up to five open asks, up to three pins. An agent with no
readable conversation reports its title instead.

## Where the messages come from

Everything is read; nothing is resumed and no provider starts.

- **Loaded agents** answer from the daemon's in-memory timeline (`readRecentConversationMessages`,
  last 200 messages).
- **Dormant Claude and Codex agents** answer from their provider transcript through
  `PersistedConversationReader` (`session-text-history.ts`): the last 1 MiB for latest messages, and
  a separate 256 KiB head read for the first user message. The head read matters because the tail
  window of a long chat does not contain its opening. The first message is cached per session id.
- **Other dormant providers** (OpenCode, ACP agents, Pi) keep history behind their runtimes, so they
  show only title, Stream asks and pins until loaded.

The first user message prefers the transcript head, then the loaded timeline, then the earliest
message in the recent window.

## Compatibility

`list_agents` fields and the RPC are additive and optional. The CLI checks
`server_info.features.workspaceDescribe` and asks for a daemon update when it is absent
(`COMPAT(workspaceDescribe)`, remove after 2027-04-28). The MCP tool runs inside the daemon, so it is
present exactly when the daemon has this change.

## Rollout

Daemon code. It reaches the live M4 daemon with the next staged build through `paseo-auto-upgrade`;
merging does not restart the running daemon.
