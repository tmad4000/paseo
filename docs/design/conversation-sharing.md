# Conversation sharing

Status: Phase 1 merged (main `eb592ed99`, PR #110); Phase 1c hardening and external publish decided
2026-10-24 (ADR-1 below). Beads epic `pspin-twk` (design `twk.1`, Phase 1 `twk.2`, Phase 2 `twk.3`,
Phase 1c `twk.7`–`twk.13`). Requested by the fork owner; first external user is Brenda Mathisen.

## Problem

A Paseo conversation lives on one daemon and is visible only to principals paired with that daemon.
Pairing grants daemon-wide authority (see [permissions.md](../permissions.md)): even the narrowest
preset, viewer, carries `workspace.read`, which covers every workspace, agent, timeline, file, diff
and terminal on the host, unredacted. The legacy relay offer is broader still: it carries the daemon
public key and the relay session id (`serverId`), and on a daemon with no password anything that
completes that handshake is a trusted operator. There is no middle ground between "sees my whole
machine" and "no access".

Today, showing someone a conversation means copying prose out of the chat into an Ideaflow Vision
note by hand, stripping tool calls, file paths and anything that looks like a credential as you go.
That curation is slow, lossy and easy to get wrong. The goal of this design is to make it
unnecessary: a shared view that is safe by default, revocable, and eventually collaborative.

Three asks, in priority order:

1. **Read-only share link.** A web page anyone with the link can open. Revocable. Optional expiry.
2. **Collaborative conversation.** Invite a human into a live agent chat with roles (viewer,
   commenter, participant who can prompt), presence, and attribution of who said what.
3. **Supporting sharing features**, proposed and ranked below: snapshot vs live, per-message
   curation, default redaction, comments and annotations, export to Vision or the Deep Dialogues
   gallery, the mobile share sheet, deep links.

## Goals and non-goals

Goals:

- A shared view never exposes secrets, tool output, reasoning, local paths or third-party contact
  details unless the owner deliberately includes them.
- Sharing is one gesture from the conversation, on desktop and phone, with a preview of exactly what
  the guest will see.
- Shares are revocable from any client, and revocation is immediate.
- Nothing about sharing weakens the pairing trust model. A share link must never be upgradable to
  daemon control.
- Protocol changes stay backward compatible; the feature is gated once on
  `server_info.features.conversationSharing`.

Non-goals (for this design):

- Public discovery, search, or a gallery inside Paseo. Shares are unlisted.
- Sharing terminals, files, diffs or browser tabs. Only agent conversations.
- Sharing across daemons (a share is served by the daemon that owns the conversation).
- Replacing Paseo Hub or the relay. Shares use neither.

## User stories

**Jacob shares a chat with Brenda (Phase 1).** Jacob is in a conversation on his phone. He opens
the conversation menu, taps **Share…**, and sees the redacted preview: his prompts and the agent's
replies, with tool calls and reasoning hidden, paths collapsed, and a masked token called out as
"1 secret hidden". He leaves the defaults, sets expiry to 7 days, taps **Create link**, and the
system share sheet opens with the URL. Brenda opens it in Safari with no app and no account and reads
the conversation. A week later the link shows "This share has expired". Jacob can also revoke it
earlier from **Manage shares**.

**Jacob shares a live chat (Phase 1b).** Same flow, but Jacob picks **Live**. Brenda's page updates
as the conversation continues, still redacted. Revoking stops updates and hides the page.

**Brenda joins live (Phase 2).** Jacob invites `brenda@…` as a **participant**. Brenda gets a link,
signs in with Ideaflow ID, and sees the same redacted view plus a composer. Jacob sees "Brenda is
viewing" in the conversation header. Brenda types a prompt; it appears in the chat labelled
**Brenda**, the agent answers, and Jacob's own prompts stay labelled **Jacob**. As a **commenter**
she could only leave comments on messages; as a **viewer** she could only read. Jacob removes her
and the view ends on her side.

**An agent shares its own work (Phase 3).** An orchestrating agent finishes a report and calls a
Paseo tool to produce a snapshot share link for the owner to forward, or exports the curated
conversation into a Vision note or the Deep Dialogues gallery.

## Concepts

Terminology follows [glossary.md](../glossary.md). New terms, UI label first:

- **Share link** — A revocable capability URL to a read-only view of one agent session. Stored as a
  **share record** on the owning daemon. Never called "public link" in UI (it is unlisted, not
  public).
- **Snapshot** — A share whose content is fixed at creation time. The default.
- **Live** — A share that re-reads the conversation on each view and streams new messages. Still
  read-only.
- **Redaction profile** — The set of rules deciding what a guest can see. Every share has one. The
  default profile is the safe one.
- **Guest** — Anyone viewing a share. In Phase 1 guests are anonymous. In Phase 2 guests may sign in
  and become **collaborators** with a **role**: viewer, commenter, or participant.
- **Share host** — The HTTP origin that serves share pages. It is a separate listener in the same
  daemon process, exposing nothing but share routes.

## Architecture

### Where a guest connects

Guests are not paired, often have no Paseo app, and must get nothing beyond the shared view. Three
options were weighed:

| Option                                                                           | Verdict                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serve shares from the daemon's main listener and expose it publicly              | Rejected. The main listener carries every daemon API and the WebSocket. Host allowlist and CORS are localhost defenses, not an authorization layer.                                                                                                                                                                                                         |
| A `viewer` principal from a pairing invitation                                   | Rejected. Permissions are daemon-wide today, so `workspace.read` exposes every workspace, timeline, file and terminal, with no redaction. A future agent-scoped grant (`{ kind: "agent", ids }`) could express "read this one conversation, redacted" and the share listener would then be one consumer of it; the redaction pipeline is needed either way. |
| Guest relay sessions reusing the pairing identity (`#offer=` style)              | Rejected for now. The relay session id is the `serverId` and the offer's public key is the trust anchor; any guest link carrying them is a full pairing offer. A guest path over the relay needs a second daemon identity (guest keypair + guest session id) and grant-scoped sessions. Viable for Phase 2 live transport, not for Phase 1.                 |
| **A share-only HTTP listener inside the daemon** (mirrors `serviceProxy.listen`) | **Chosen.** Serves `/s/<token>` and nothing else. Reads only share records and their stored snapshots. Published through a reverse proxy, Tailscale Funnel, or Cloudflare Tunnel on an origin the owner configures.                                                                                                                                         |

The share listener is deliberately a separate `http.Server` with its own Express app. It mounts no
daemon routes, no WebSocket upgrade, no web UI, no MCP. The only state it can read is
`$PASEO_HOME/shares/`. A bug in the share surface therefore cannot reach timelines, files, or
agents.

```
Owner (paired client)                       Guest (any browser)
   │ share.link.create.request                  │ GET https://<shareHost>/s/<token>
   ▼                                            ▼
Daemon main listener ──► ShareService ──► $PASEO_HOME/shares/{id}.json
                               │                 {id}.snapshot.json
                               └── RedactionPipeline(timeline rows) ──► ShareListener (separate port)
```

### Configuration

```json
{
  "daemon": {
    "sharing": {
      "listen": "127.0.0.1:8443",
      "publicBaseUrl": "https://m4-mini.tailb2a35c.ts.net:8443",
      "ownerDisplayName": "Jacob"
    }
  }
}
```

- `listen` starts the share listener. Absent means sharing is off; `share.link.create` fails with
  `sharing_not_configured` and the app shows how to enable it.
- `publicBaseUrl` is the origin guests use. The daemon never guesses it from request headers.
- `ownerDisplayName` labels the owner's messages for guests. Defaults to the OS user name.
- Env equivalents: `PASEO_SHARING_LISTEN`, `PASEO_SHARING_PUBLIC_BASE_URL`,
  `PASEO_SHARING_OWNER_NAME`.

Publishing the listener is an operator step outside the daemon (Tailscale Funnel, Cloudflare Tunnel,
nginx). The M4 already has Funnel enabled for `:8443` with no handler attached, so the first
deployment is one `tailscale serve` line; see Open decisions.

## Data model

### Share record — `$PASEO_HOME/shares/{shareId}.json`

Written atomically with `writeJsonFileAtomic`, validated with Zod, optional fields with defaults, no
migrations (per [data-model.md](../data-model.md)).

| Field            | Type                   | Notes                                                                                 |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `id`             | `string`               | `shr_<16 hex>`. Internal id, shown in Manage shares, never in the URL.                |
| `agentId`        | `string`               | The shared agent session.                                                             |
| `workspaceId`    | `string?`              | Copied at creation for listing. Never used for access.                                |
| `tokenHash`      | `string`               | SHA-256 of the URL capability. The plaintext token is returned once and never stored. |
| `mode`           | `"snapshot" \| "live"` | Default `snapshot`.                                                                   |
| `title`          | `string`               | Owner-editable; defaults to the agent title.                                          |
| `redaction`      | `RedactionProfile`     | See below.                                                                            |
| `createdAt`      | `string` (ISO 8601)    |                                                                                       |
| `expiresAt`      | `string \| null`       | `null` = never.                                                                       |
| `revokedAt`      | `string \| null`       | Soft revoke. Revoked records stay listed until deleted.                               |
| `snapshotSeqEnd` | `number?`              | For snapshots: last source `seq` included.                                            |
| `viewCount`      | `number`               | Incremented on successful render. Best effort.                                        |
| `lastViewedAt`   | `string \| null`       |                                                                                       |
| `collaborators`  | `Collaborator[]`       | Phase 2. Default `[]`.                                                                |

### Snapshot — `$PASEO_HOME/shares/{shareId}.snapshot.json`

The **already-redacted** projection, stored at creation. The share listener serves this file and
never re-reads the source timeline for snapshot shares. Live shares re-run the pipeline on each
request and are bounded to the most recent 500 projected items with "earlier messages omitted" at
the top.

```ts
interface ShareSnapshot {
  v: 1;
  title: string;
  owner: { name: string };
  agent: { provider: string; model?: string };
  createdAt: string;
  messages: SharedMessage[];
  redactionSummary: {
    hiddenToolCalls: number;
    hiddenReasoning: number;
    secretsMasked: number;
    pathsCollapsed: number;
    contactsMasked: number;
    messagesExcluded: number;
  };
}
type SharedMessage =
  | {
      kind: "user";
      id: string;
      at: string;
      author: { name: string; role: "owner" | "participant" };
      text: string;
    }
  | { kind: "assistant"; id: string; at: string; text: string }
  | {
      kind: "omitted";
      id: string;
      at: string;
      reason: "tool_calls" | "reasoning" | "excluded";
      count: number;
    };
```

`omitted` rows exist so the reader sees that work happened between two messages ("12 tool calls
hidden") instead of a confusing jump. They carry no detail.

### RedactionProfile

```ts
interface RedactionProfile {
  include: { toolCalls: boolean; reasoning: boolean; errors: boolean }; // all default false
  scrub: { secrets: boolean; paths: boolean; contacts: boolean }; // all default true
  excludedMessageIds: string[]; // per-message curation
  extraPatterns: string[]; // owner-supplied literal strings to mask
}
```

## Auth

### Phase 1: capability token for read-only links

- The URL is `https://<publicBaseUrl>/s/<token>`. `token` is 32 random bytes from
  `crypto.randomBytes`, base64url (43 chars). It is the only credential.
- The daemon stores `sha256(token)` and compares with `timingSafeEqual`. The plaintext is shown to
  the owner once at creation (and copied to the clipboard / share sheet) and is otherwise
  unrecoverable. Losing it means creating a new share.
- Access checks in order: token hash matches an existing record → not revoked → not expired → render.
  Every failure returns the same 404 page ("This share isn't available") so the listener leaks
  nothing about which shares exist.
- Responses set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Robots-Tag: noindex, nofollow`, a strict CSP (`default-src 'none'; style-src 'self'; script-src
'self'; img-src 'self' data:`), and `X-Content-Type-Options: nosniff`. No cookies in Phase 1.
- Rate limit: 60 requests per minute per IP on `/s/*`, 10 per minute for unknown tokens, in-memory.
- Token path is logged hashed only. The daemon log never contains a plaintext share token.

Why not the fragment (`#token`)? The listener must validate before rendering, so the secret has to
reach the server. The URL path is fine because the page is same-origin, sets `no-referrer`, and the
share host serves nothing else; the trade-off is that the token appears in the owner's reverse proxy
access logs, which is accepted and documented.

### Phase 2: identified collaborators via Ideaflow ID

- Collaboration requires identity. The share listener becomes an OIDC relying party against
  `id.ideaflow.app` (standard code flow with PKCE; client id and secret from daemon config). The
  owner invites by email; the invitee signs in with any Ideaflow ID whose verified email matches.
- Session cookie on the share host only: `HttpOnly; Secure; SameSite=Lax`, 7-day lifetime, bound to
  the share id. No cookie grants anything on the daemon's main listener.
- Authority is stored as explicit share permissions on the collaborator record, never as a role
  name, following the daemon's rule that presets are UI and permissions are the persisted truth:
  `share.read` (view, presence), `share.comment` (comments on messages), `share.prompt` (send
  prompts). The Manage shares UI offers the presets **Viewer** (`share.read`), **Commenter**
  (`share.read`, `share.comment`) and **Participant** (all three) and expands them. Permissions are
  additive allows; missing authority denies. They are per share and per collaborator, and are not
  daemon permissions: a collaborator is not a daemon principal and holds no daemon credential.
- Participant prompts enter the daemon through `ShareService`, which calls the same prompt path a
  trusted client uses, with `author: { name, ideaflowUserId, role: "participant" }` stamped on the
  user message. They are subject to the agent's normal permission model; a participant cannot
  approve permissions, change mode, model, or archive. Only the owner sees permission prompts.
  Inside the daemon the forwarded prompt runs under the owner's authority on that one agent; the
  share listener is the attenuation boundary, and the authorization module keeps classifying the
  operation (`workspace.write`) as it does for any client.
- The guest never holds a daemon credential. All collaborator traffic terminates at the share
  listener and is forwarded in-process with explicit, narrow service calls (not a `Session` with
  grants; that stays an option for the relay-transport variant later).

## Redaction and safety model

Shared views are safe by default. The pipeline runs on the daemon, on canonical timeline rows,
before anything is written to a snapshot or sent to a guest.

### Step 1: item filter

| Timeline item type                                         | Default             | Owner can include?                                                                           |
| ---------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `user_message`                                             | shown               | per-message exclude                                                                          |
| `assistant_message`                                        | shown               | per-message exclude                                                                          |
| `reasoning`                                                | hidden (counted)    | yes, `include.reasoning`                                                                     |
| `tool_call` (shell, read, edit, write, search, mcp, other) | hidden (counted)    | yes, `include.toolCalls` — shows name and a one-line summary only, never output or arguments |
| `error`, `notification`                                    | hidden              | yes, `include.errors` — message text only                                                    |
| `todo`, `compaction`, `plugin`                             | hidden, not counted | no                                                                                           |

Permission requests, usage, mode/model changes, Stream entries, attachments, and uploaded images are
never shared in Phase 1.

### Step 2: text scrubbers (applied to shown text)

- **Secrets** (`scrub.secrets`): high-confidence patterns replaced by `[secret hidden]`: `sk-…`,
  `sk-ant-…`, `ghp_`/`gho_`/`github_pat_`, `AKIA[0-9A-Z]{16}`, `xox[abprs]-…`, `AIza…`, JWTs
  (`eyJ…\.…\.…`), `-----BEGIN … PRIVATE KEY-----` blocks, `Bearer <token>`, URL query values for
  `token|key|secret|password|sig|signature|access_token`, `password=`/`passwd:` assignments, and any
  base64url/hex run ≥ 32 chars adjacent to `key|token|secret|auth` within 20 chars. Patterns live in
  one module with table-driven tests; false negatives are expected, so this is defense in depth,
  not the reason tool output is hidden.
- **Paths** (`scrub.paths`): absolute local paths (`/Users/<u>/…`, `/home/<u>/…`, `/Volumes/…`,
  `/private/…`, `/tmp/…`, `C:\Users\…`, `~/…`) collapse to `…/<last two segments>`. Paths inside
  fenced code blocks are collapsed too. Repository-relative paths (no leading `/`, `~` or drive) are
  kept; they are usually the point of the message.
- **Contacts** (`scrub.contacts`): emails → `[email]`, E.164-looking phone numbers → `[phone]`,
  except the owner's own display name and any string in an owner allowlist. Names are not
  redacted automatically (no reliable rule); per-message exclusion and `extraPatterns` cover them.
- **Extra patterns**: owner-supplied literal strings, masked everywhere.

### Step 3: summary and preview

The pipeline returns the snapshot plus a `redactionSummary`. The app shows the summary in the share
sheet ("14 tool calls hidden · 2 secrets masked · 9 paths collapsed") and renders the exact snapshot
as the preview. What the owner previews is byte-for-byte what the guest gets.

### Invariants (tested)

1. No `tool_call` arguments or output ever appear in a snapshot, in any profile.
2. With the default profile, a timeline seeded with every secret fixture yields zero fixture
   matches in the snapshot.
3. A revoked or expired share returns 404 within one request of the change (no caching layer).
4. The share listener process path cannot read `agents/`, `config.json`, or any file outside
   `shares/`: the service is constructed with a `sharesDir` and uses no other path.
5. Snapshot mode is immutable: later conversation turns never change a snapshot's bytes.

## Protocol and feature gate

New RPCs follow [rpc-namespacing.md](../rpc-namespacing.md). All new fields optional.

| Request → Response                          | Purpose                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `share.link.preview.request` → `.response`  | Run the pipeline for `{ agentId, redaction }`; return `ShareSnapshot` + summary. No record written.                                              |
| `share.link.create.request` → `.response`   | `{ agentId, mode, title?, expiresAt?, redaction }` → `{ share: ShareRecordPayload, url: string }`. The only time `url` (with token) is returned. |
| `share.link.list.request` → `.response`     | `{ agentId? }` → records for one agent or the whole daemon. No tokens.                                                                           |
| `share.link.update.request` → `.response`   | Edit `title`, `expiresAt`, `redaction` (live shares only for redaction), roles (Phase 2).                                                        |
| `share.link.revoke.request` → `.response`   | Sets `revokedAt`. Idempotent.                                                                                                                    |
| `share.link.delete.request` → `.response`   | Removes record and snapshot.                                                                                                                     |
| `share.link.update` (server → client event) | Broadcast on create/update/revoke so every client's Manage shares list agrees.                                                                   |

`server_info.features.conversationSharing: true` with a `// COMPAT(conversationSharing): fork
feature, added in fork v0.10.0-beta.17, drop the gate after 2027-04-24.` comment at the one gate
site. The app checks the flag in one place; an older host shows "Update the host to share
conversations." No fallback path.

Share records on the wire (`ShareRecordPayload`) omit `tokenHash`.

## Surfaces

### App (desktop, web, phone)

- **Share…** in the conversation header actions menu (`workspace-header-menu.tsx`, beside Rename and
  the copy-link actions from #99) and in the Command Center. Opens a sheet (compact) or dialog
  (wide):
  1. Preview of the redacted conversation, scrollable, with the summary line on top.
  2. **What's included**: Tool calls (off), Reasoning (off), Errors (off). **Hide**: Secrets (on),
     File paths (on), Emails and phone numbers (on). Changing a toggle re-runs the preview.
  3. **Mode**: Snapshot (default) / Live (Phase 1b).
  4. **Expires**: Never / 24 hours / 7 days (default) / 30 days.
  5. **Create link** → on native, the system share sheet with the URL; on web/desktop, copied to the
     clipboard with a toast and shown in the dialog with a Copy button.
- **Manage shares** at the bottom of the same sheet and in host Settings: title, mode, expiry, views,
  last viewed, **Copy link** (disabled: token not recoverable; shows "Create a new link"), **Revoke**,
  **Delete**.
- A small **Shared** badge on the conversation header while at least one unrevoked share exists.
- All copy localized in the nine locales per [i18n.md](../i18n.md).

### CLI

```
paseo share create <agent> [--live] [--expires 7d] [--include tool-calls,reasoning] [--no-scrub paths] [--title "…"]
paseo share ls [<agent>] [--json]
paseo share revoke <share-id>
paseo share delete <share-id>
paseo share preview <agent> [--json]
```

### Agent tools (Phase 3)

`create_share_link` and `list_share_links` in the Paseo tool catalog, owner-gated like other
mutating tools, so an orchestrator can hand the owner a link at the end of a job.

### Guest page

Server-rendered HTML from a template in `packages/server/src/server/sharing/view/`, no framework,
one small script for live updates and relative timestamps. Markdown rendered server-side with the
same sanitizer the app uses (no raw HTML, links `rel="noopener noreferrer nofollow"`, no images in
Phase 1). Header: title, owner name, provider and model, created date, "Shared read-only with
Paseo" footer. Mobile-first typography; respects `prefers-color-scheme`. Visual direction is the
clean product look from [design.md](../design.md), not the marketing site.

## Collaboration (Phase 2 design)

- **Invite**: owner adds an email and picks a preset in Manage shares. The daemon creates a
  `Collaborator` `{ email, permissions, invitedAt, acceptedAt?, ideaflowUserId? }` and returns an invite URL
  (`/s/<token>?invite=<inviteId>`). Jacob sends it himself; Paseo does not email in Phase 2.
- **Join**: the guest page offers **Sign in with Ideaflow** when the share has collaborators. After
  OIDC, the verified email must match an invite; the collaborator is bound to that
  `ideaflowUserId` and the share-host session cookie is issued.
- **Presence**: the share listener keeps an in-memory set of connected collaborators per share (SSE
  heartbeats). It publishes `share.presence.update` to paired clients; the app shows avatars/names in
  the conversation header and in the Stream.
- **Attribution**: `user_message` gains optional `author?: { name: string; kind: "owner" |
"participant"; externalId?: string }`. Absent means owner (today's behavior, so old timelines and
  old clients are unaffected). The app renders participant prompts with the author's name; the guest
  page does the same. Providers receive the prompt text prefixed with `[From Brenda]` so the model
  also knows who is speaking; the prefix is stripped from the shared and local rendering by the
  canonical row's `author` field, never by text matching.
- **Comments**: `commenter` and above can anchor a comment to a `SharedMessage.id`. Comments store in
  `shares/{id}.comments.json`, show on the guest page, and surface to the owner as a Stream entry of
  kind `comment` (new companion entry kind, emitted only to clients that advertise the capability).
  Owner replies in chat, not in the comment thread, in Phase 2.
- **Live transport for collaborators**: SSE from the share listener (one-way) plus `POST /s/<token>/prompt`
  and `/comment` with the session cookie and a CSRF token. WebSocket is unnecessary for this traffic
  volume and keeps the share host simple. A relay-based guest transport with a second daemon
  identity stays documented as the path to "collaborate without exposing a listener" if that becomes a
  requirement.
- **Safety**: participants cannot see or answer permission prompts, cannot change agent settings,
  cannot attach files, cannot see tool output (same redaction profile as viewers), and their prompts
  are rate limited (6 per minute). The owner can downgrade or remove a collaborator instantly; the
  SSE stream closes on the next heartbeat.

## Other sharing features, ranked

Ranked by value to the first users divided by cost. Phase assignments follow this order.

| Rank | Feature                                                             | Why                                                                                                                                                                               | Phase  |
| ---- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1    | Default redaction (tool calls, reasoning, secrets, paths, contacts) | The whole reason manual curation exists today. Without it no link is safe to send.                                                                                                | 1      |
| 2    | Snapshot vs live                                                    | Snapshot is immutable and cheap and covers "look at this". Live is what makes Brenda's view useful while work continues.                                                          | 1 / 1b |
| 3    | Mobile share sheet + clipboard                                      | Jacob shares from the phone. One tap after Create link.                                                                                                                           | 1      |
| 4    | Per-message curation (exclude a message)                            | Cheap once the preview exists: a hide toggle per row in the preview. Removes the last reason to copy by hand.                                                                     | 1b     |
| 5    | Collaborators with roles, presence, attribution                     | The second ask. Needs identity, so it is its own phase.                                                                                                                           | 2      |
| 6    | Comments and annotations                                            | Natural once collaborators exist; viewer-side value is high, owner-side plumbing (Stream entry) is moderate.                                                                      | 2      |
| 7    | Export to Ideaflow Vision note                                      | Replace today's manual note with one action that writes the redacted snapshot as Markdown through the existing Vision MCP tools or API. Small, high value for Jacob specifically. | 3      |
| 8    | Export to Deep Dialogues gallery                                    | Same snapshot, different target. Gallery backend is a paused Supabase project (see tmpworkspace memory `deep-dialogues-supabase-paused`), so this waits on that restore.          | 3      |
| 9    | Deep links into a share (`/s/<token>#m=<id>`)                       | Link to one message. Trivial on the guest page; included once anchors exist.                                                                                                      | 1b     |
| 10   | Agent-created share links (MCP tools)                               | Lets orchestrators deliver results as links. Low cost after Phase 1, but owner review of the preview is lost, so default to snapshot + strictest profile.                         | 3      |
| 11   | Custom redaction rules UI (`extraPatterns`)                         | Needed occasionally; a text field in the sheet.                                                                                                                                   | 1b     |
| 12   | Owner-visible view log (count, last viewed)                         | Cheap signal that the link was used. No per-viewer identity in Phase 1.                                                                                                           | 1      |

## Phased plan

### Phase 1 — read-only snapshot links with default redaction (`pspin-twk.2`)

Server:

- `packages/server/src/server/sharing/`: `share-store.ts` (Zod schema, atomic JSON, list/get/put),
  `redaction.ts` (pipeline + pattern table), `share-service.ts` (preview/create/list/update/revoke/
  delete, token generation + hashing, expiry), `share-listener.ts` (separate Express app and server,
  routes `GET /s/:token`, `GET /s/:token.json`, 404 page, headers, rate limit), `view/` (template +
  CSS + Markdown render).
- Config: `daemon.sharing.{listen,publicBaseUrl,ownerDisplayName}` and env equivalents in
  `config.ts`/`persisted-config.ts`, mirroring `serviceProxy`.
- Bootstrap: construct `ShareService` with `agentManager`/timeline store and `sharesDir`; start the
  listener after the main listener when `sharing.listen` is set; stop it on shutdown; feature flag in
  `websocket-server.ts` next to `companionStream`.
- Session: handle the `share.link.*` requests; broadcast `share.link.update`.
- Protocol: schemas in `packages/protocol/src/messages.ts` (discriminated unions, optional fields),
  regenerate validation per [protocol-validation.md](../protocol-validation.md).

Client:

- `@getpaseo/client`: typed methods for the five RPCs.
- App: Share sheet/dialog, Manage shares, header badge, Command Center item, capability gate, i18n
  in all locales, native share sheet on iOS/Android, clipboard on web/desktop.
- CLI: `paseo share create|ls|revoke|delete|preview`.

Docs: this file updated with "as built" notes; AGENTS.md docs table row; `docs/fork-features.md`
row `conversation-share-links`; `public-docs` entry for configuring `daemon.sharing`.

Explicitly out of Phase 1: live mode, per-message exclusion UI (the field exists in the profile and
the CLI may set it), collaborators, comments, exports, MCP tools, images/attachments in shares.

### Phase 1b — live read-only, curation, deep links

Live mode (re-project on view, SSE for new messages, bounded tail), per-message exclude in the
preview, `extraPatterns` field, message anchors.

### Phase 2 — collaborators (`pspin-twk.3`)

Ideaflow ID OIDC on the share host, invites, roles, presence, attribution (`author` on
`user_message`), participant prompting, comments to Stream.

### Phase 3 — exports and agent tools

Export to Vision note; export to Deep Dialogues when its backend is restored; `create_share_link`
tool; owner-side comment replies.

## Acceptance tests

### Phase 1 (automated unless marked manual)

Redaction (`redaction.test.ts`, table-driven):

1. Default profile on a fixture timeline with 3 user messages, 3 assistant messages, 12 tool calls,
   4 reasoning rows, 1 error → 6 message rows + `omitted` rows totaling 12 tool calls and 4
   reasoning; `summary.hiddenToolCalls === 12`; no string from any tool argument or output appears.
2. Every secret fixture (one per pattern) in user and assistant text → `[secret hidden]`;
   `summary.secretsMasked` equals fixture count; no fixture substring survives.
3. Paths: `/Users/jacob/code/paseo-fork/packages/server/src/x.ts` → `…/src/x.ts`; `~/.paseo/config.json`
   → `…/.paseo/config.json`; `packages/app/src/x.tsx` unchanged; paths inside fenced code collapse.
4. Contacts: emails and E.164 numbers masked; owner display name untouched.
5. `include.toolCalls: true` shows `Ran shell command` style summaries only; still no output.
6. `excludedMessageIds` removes the message and adds one `omitted` row with reason `excluded`.
7. Idempotent: running the pipeline on an already-redacted snapshot changes nothing.

Store and service (`share-service.test.ts`):

8. Create returns a 43-char base64url token exactly once; the stored record has only `tokenHash`;
   `list` never returns a token; a second create for the same agent yields a different token.
9. Snapshot immutability: append new rows to the agent after creation; the served snapshot bytes are
   unchanged.
10. Revoke → `revokedAt` set; `revoke` twice is a no-op; `delete` removes both files.
11. Expiry: a record with `expiresAt` in the past is not served; `expiresAt: null` is served.
12. `share.link.update` broadcast reaches two connected sessions on create and revoke.

Listener (`share-listener.test.ts`, real HTTP on an ephemeral port):

13. Valid token → 200 HTML containing the title and messages, with the required headers
    (`no-store`, `no-referrer`, `noindex`, CSP, `nosniff`), no `Set-Cookie`.
14. Unknown, revoked, expired, and malformed tokens → identical 404 body and headers.
15. Any other path (`/`, `/api/health`, `/mcp/agents`, `/s/`) → 404; no WebSocket upgrade accepted.
16. 11th unknown-token request in a minute from one IP → 429.
17. Starting the daemon with no `sharing.listen` → no listener bound; `share.link.create` →
    `sharing_not_configured`.

End-to-end (`sharing.e2e.test.ts` with the in-process daemon harness from
[ad-hoc-daemon-testing.md](../ad-hoc-daemon-testing.md)):

18. Create agent with a mock provider → produce rows including a tool call with a fake API key in
    its output → `share.link.create` → fetch the URL → page shows prompts and replies, no key, "1
    tool call hidden" → revoke → fetch → 404.

Client and CLI:

19. `paseo share create <agent> --expires 7d` prints the URL once; `paseo share ls --json` lists
    the record without a token; `paseo share revoke` flips it.
20. App: the preview rendered in the Share sheet equals `share.link.preview.response` content; an
    older host (flag absent) shows the update message and no Share action in the menu.

Manual, on a prepared build (recorded in the PR QA section):

21. Phone: Share… → Create link → system share sheet opens with the URL; paste into Messages; open
    on a device with no Paseo app; the conversation reads correctly in light and dark mode.
22. Desktop: Share… → link copied; Manage shares shows views incrementing after opening the link.

### Phase 2 (outline)

Invite/sign-in binding by verified email; role enforcement (viewer cannot POST prompt or comment;
commenter cannot prompt); participant prompt appears in owner's chat with the author label and
reaches the provider; presence appears and disappears within one heartbeat; owner removal closes
the stream; permission prompts never reach guests.

## Phase 1c — hardening and external publish (decided 2026-10-24)

Jacob's decision after the Funnel threat model: harden the pipeline and publish snapshots to an
external host so nothing on the M4 has to be internet-reachable. No Funnel or `tailscale serve`
change for shares. The local listener stays behind `daemon.sharing.listen`, default off. Order of
work, one PR each: `pspin-twk.10` → `pspin-twk.7` (with `twk.11`) → `pspin-twk.13` → `twk.4`,
`twk.9`, `twk.8`.

### ADR-1: external publish target is a Cloudflare Worker with Workers KV

**Context.** Three candidates: an unlisted Ideaflow Vision note via the existing share and revoke
API; a Cloudflare Worker with KV or R2; Cloudflare Pages. Criteria: revocation guarantee, expiry,
link-unfurler behaviour, coupling of Paseo Fork to Ideaflow, operational fit for a daemon, cost.

**Decision.** Cloudflare Worker + Workers KV, in `packages/share-worker`, served from a
`*.workers.dev` hostname first (custom domain is a later product choice).

| Criterion           | Vision note                                                                                                                          | Worker + KV (chosen)                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Revocation          | `revoke_note_share`; page caching and propagation are Vision's, not ours                                                             | KV `delete`, read on every request with `Cache-Control: no-store`; eventual consistency bounds revocation to about 60 s worldwide |
| Expiry              | None native; daemon would have to revoke on a timer                                                                                  | `expirationTtl` on the KV entry: the host forgets the snapshot by itself even if the daemon is off                                |
| Unfurlers           | Vision's page `<title>`/meta, outside our control                                                                                    | We serve the bytes: generic `<title>`, no description/og meta, `noindex`, same CSP as the local listener                          |
| Coupling            | Paseo Fork depends on an Ideaflow account; daemon needs an Auth0 user token that expires and is refreshed through a Chrome extension | One long-lived admin secret the daemon holds in a mode-600 file; no account coupling for guests                                   |
| Daemon fit          | Interactive token refresh is unfit for an always-on daemon                                                                           | Outbound HTTPS `PUT`/`DELETE` only                                                                                                |
| Rate limiting / DoS | Vision's                                                                                                                             | Workers rate-limiting binding per client IP; zone WAF rules later if a custom domain is added                                     |
| Cost                | Free                                                                                                                                 | Free tier (Workers 100k req/day, KV 1k writes/day); no new paid resource                                                          |
| Availability        | Served while the M4 is offline                                                                                                       | Served while the M4 is offline                                                                                                    |

R2 and Pages were rejected: KV's TTL matches expiry exactly and values are small (bounded 2 MiB
HTML); R2 adds lifecycle rules for no benefit, and Pages is a per-deploy static site, the wrong
shape for per-share objects. The Vision note remains a good **export** target (Phase 3): a person
who wants the conversation in their notes, not a link host.

**Consequences.** A second deployable (the Worker) with its own deploy step, done by the
orchestrating session after the PR merges, never by the implementer. The daemon gains a publisher
abstraction; the local listener is one of two "hosts". Revocation becomes "revoked at the host
within about a minute" instead of "on the next request"; the UI says so.

### twk.10 — redaction gaps

Probe on 2026-10-24 against the built pipeline leaked, verbatim: `100.84.242.74`,
`m4-mini.tailb2a35c.ts.net`, `142.249.144.90`, `Authorization: Basic amFjb2I6…`,
`AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCyEXAMPLEKEY` (the `/` breaks the 32-char run),
`the wifi password is hunter2`, `sshpass -p 'iPsj…'`, `617-555-0199`, `(415) 555-0123`. The URL
`postgres://jacob:Sup3rSecret@db.internal:5432/app` was masked by accident (the email rule ate
`Sup3rSecret@db.internal:5432`), leaving the username and a misleading `[email]`.

Rules to add (placeholders in brackets are literal output):

| Rule                                                                                                                                       | Output                              | Counter          |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ---------------- |
| URL userinfo `scheme://user:pass@host`, `scheme://user@host`                                                                               | `scheme://[credentials]@host`       | `secretsMasked`  |
| `Basic <base64>` after `Authorization:` or standalone                                                                                      | `Basic [secret hidden]`             | `secretsMasked`  |
| Labelled value: `[A-Z0-9_]*(KEY\|SECRET\|TOKEN\|PASSWORD\|PASSWD\|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*('…'\|"…"\|\S+)` (case-insensitive label) | label kept, value `[secret hidden]` | `secretsMasked`  |
| Base64 or hex run ≥ 32 chars including `/ + =` within 20 chars of key/secret/token/password/auth/credential                                | `[secret hidden]`                   | `secretsMasked`  |
| Prose: `(password\|passphrase\|passcode\|pin)\s+(is\|was\|=\|:)\s+\S+`                                                                     | `password is [secret hidden]`       | `secretsMasked`  |
| CLI flags `-p`, `--password`, `--token`, `--api-key`, `--secret`, `--key` followed by `=`/space and a value (quoted or bare)               | flag kept, value `[secret hidden]`  | `secretsMasked`  |
| IPv4 (octets 0–255, not followed by more dotted numbers) and IPv6 (incl. `::`), port kept                                                  | `[ip]`, e.g. `[ip]:6767`            | `hostsMasked`    |
| Hostnames ending `.ts.net`, `.local`, `.internal`, `.lan`, `.home.arpa`, `.localdomain`, and `localhost`                                   | `[host]`                            | `hostsMasked`    |
| NANP phones `\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}` in addition to E.164                                                                         | `[phone]`                           | `contactsMasked` |

Public FQDNs (`github.com`, `ideaflow.app`) and relative paths are kept. Version strings
(`0.10.0-beta.16`, `14.3.2`) and `x.y.ts` must not match the IPv4 rule: require four octets each
≤ 255 and reject when preceded by `v` or followed by `-[a-z]`. Order stays: literals → secrets →
hosts → paths → contacts, each pass skipping existing placeholders.

Wire change: `RedactionProfile.scrub.hosts: z.boolean().optional()` (absent = `true`);
`RedactionSummary.hostsMasked: z.number().optional()`. UI: a fourth Hide toggle, **Hostnames and
IP addresses** (on). CLI: `--no-scrub hosts`. All nine locales.

Test corpus (`redaction-corpus.test.ts`, table-driven, each row asserts the exact output and the
counters): the nine probe strings above with expected outputs, the accidental-mask case
(`postgres://jacob:Sup3rSecret@db.internal:5432/app` → `postgres://[credentials]@[host]:5432/app`),
plus negatives: `0.10.0-beta.16`, `v1.2.3.4`, `src/x.y.ts`, `https://github.com/tmad4000/paseo`,
`see RFC 1918`, `call 911`. Idempotence: a second pass changes nothing.

### twk.7 — pre-render and bound at create; serve static bytes (includes twk.11)

- `sharing/render.ts` owns `renderSharePage` and `markdown-it`; `share-listener.ts` and
  `view/page.ts` no longer import markdown-it. The listener's request path performs no parsing.
- Bound before render: keep the **latest** 500 `SharedMessage` rows (omitted rows count). If any
  were dropped, prepend one `omitted` row `{ reason: "earlier", count }` rendered as "N earlier
  messages are not included in this snapshot". Then render; if HTML exceeds 2 MiB, drop the oldest
  rows and re-render until it fits. The JSON stored is the same bounded list.
- Store `{id}.snapshot.html` and `{id}.snapshot.json` atomically, then the record (unchanged
  publish-after-durable order). `ShareStore.view(token)` returns `{ html: Buffer, json: Buffer,
title }`; the listener streams bytes with `Content-Length`.
- Title update re-renders from the stored JSON and rewrites the HTML (owner-triggered, cheap).
- twk.11: `<title>` is the literal "Shared conversation"; no `description`/`og:*` meta; the real
  title appears only in the body `<h1>`. Document in `public-docs/configuration.md` that pasting a
  link into a messenger makes that service fetch the page (counts as a view).
- Tests: bound at exactly 500 (501 → 500 + earlier row), 2 MiB cap, listener serves identical bytes
  to the stored file, no `markdown-it` import reachable from `share-listener.ts` (assert via a
  module-graph test or by making `render.ts` the only importer), title update rewrites HTML,
  `<title>` generic.

### twk.13 — publisher: daemon side

Config (`persisted-config.ts`, env equivalents, schema file, docs):

```json
{
  "daemon": {
    "sharing": {
      "publisher": {
        "kind": "cloudflare-worker",
        "baseUrl": "https://paseo-share.<account>.workers.dev",
        "adminTokenFile": "~/.config/paseo/share-admin-token"
      }
    }
  }
}
```

- `kind` is a discriminated union with one member today. `adminTokenFile` (mode 600) or
  `PASEO_SHARING_PUBLISHER_TOKEN`. When a publisher is configured, share URLs are
  `${baseUrl}/s/<token>` and `publicBaseUrl`/`listen` are not required; if both are configured the
  publisher wins for URLs and the local listener keeps serving the same snapshot.
- `ShareHost` interface: `publish({ tokenHash, html, json, expiresAt })`, `unpublish(tokenHash)`.
  Implementations: `LocalListenerHost` (no-op publish; serving happens from the store) and
  `CloudflareWorkerHost` (`PUT {baseUrl}/admin/shares/{tokenHash}` with
  `Authorization: Bearer <admin token>`, JSON body `{ html, json, expiresAt }`; `DELETE` for
  unpublish; 10 s timeout; one retry on network error).
- Create: render → publish → store record with `published: { kind, baseUrl, at }`. Publish failure
  fails the create with `share_publish_failed` and persists nothing.
- Revoke/delete: set `revokedAt` locally first, then `unpublish`. On failure persist
  `publishState: "unpublish_pending"` and retry with backoff (1 min, 5 min, 30 min, then hourly)
  from a small daemon-side queue that survives restarts; Manage shares shows "Revoke pending at
  the host" until it clears. Revocation at the host is also bounded by KV consistency (~60 s);
  copy says "within about a minute".
- Expiry update re-publishes with the new TTL; title update re-renders and re-publishes.
- RPCs unchanged in shape; `ShareRecordPayload` gains optional `published` and `publishState`.
- The e2e test runs a local fake Worker (`http.createServer` implementing the admin contract) to
  prove publish, unpublish, retry-after-failure and URL construction without network.

### twk.13 — publisher: Worker side (`packages/share-worker`)

- Routes: `GET /s/<43-char token>` → `sha256(token)` → KV `h:<hash>` → HTML; `GET /s/<token>.json`
  → KV `j:<hash>`. Everything else, including unauthenticated `/admin/*`, returns the identical
  404 page. `PUT|DELETE /admin/shares/<64 hex>` require `Authorization: Bearer <ADMIN_TOKEN>`
  (Worker secret, constant-time compare); `PUT` body is validated (`html` ≤ 2 MiB, `json` ≤ 2 MiB,
  `expiresAt` ISO or null → `expirationTtl` ≥ 60 s or none); responds 204. Unauthenticated admin
  requests get the same 404 as guests, so the daemon treats a 404 on `PUT` as a configuration error.
- Headers on guest responses: identical to the local listener (`no-store`, `no-referrer`,
  `noindex, nofollow`, the same CSP string exported from `render.ts`, `nosniff`); no cookies.
- Rate limiting: Workers Rate Limiting binding keyed by `cf-connecting-ip`: 60/min per IP, 10/min
  unknown-token per IP; admin routes 30/min per IP. Tokens never appear in logs (no `console.log`
  of URLs; observability logs off or sampled without request URLs).
- Tests: vitest in the node environment with a fake KV and plain `Request` objects: hash lookup,
  404 parity (body and headers byte-identical for unknown/expired/malformed/admin-unauth), headers,
  admin auth and validation, TTL passthrough, method handling.
- Deploy (orchestrating session, after merge): `wrangler kv namespace create SHARES` once,
  `wrangler secret put ADMIN_TOKEN`, `wrangler deploy` with `CLOUDFLARE_ACCOUNT_ID` and an API
  token that has Workers Scripts and KV edit permissions (the existing CLI token may lack them; a
  Workers-scoped token is the clean path and is a Jacob step if needed). Record the deployed URL
  and the admin-token file path in `public-docs/configuration.md` and in the ops memory.

### Small follow-ups

- **twk.9** listener surface: `app.set("query parser", false)`; `server.headersTimeout = 15_000`,
  `requestTimeout = 30_000`, `keepAliveTimeout = 5_000`, `maxHeadersCount = 50`; reject
  `req.url.length > 256` and any method other than `GET`/`HEAD` before touching the store; `HEAD`
  answers like `GET` without a body; the listener receives `{ view }` only, not the store object.
- **twk.4** proxy-aware limits: `daemon.sharing.trustForwardedFor: boolean` (default false). When
  true and the socket peer is loopback or in `100.64.0.0/10`, key limits on the first
  `X-Forwarded-For` hop; always keep a global ceiling (600/min). Only matters if a listener is ever
  published; documented as not in use.
- **twk.8** markdown-it: upgrade to `14.3.2` (released 2026-09-12, policy-compliant on
  2026-10-24; fixes CVE-2022-21670). `14.3.3` (2026-10-16) is allowed after 2026-11-16. The app's
  markdown-it moves with it.

### Acceptance, Phase 1c

1. Corpus test passes with the exact outputs above; the Phase 1 redaction tests still pass.
2. A 5,000-message fixture shares as 500 messages plus one "earlier" row; the guest page and
   `.json` are byte-identical to the stored files; a request to the listener performs no Markdown
   rendering (asserted by a spy on `render.ts` in the listener test).
3. With the fake Worker: create publishes and returns `${baseUrl}/s/<token>`; the fake receives
   `html`, `json`, `expiresAt`; revoke sends `DELETE`; a failing `DELETE` leaves
   `publishState: "unpublish_pending"` and succeeds on retry; a failing `PUT` fails the create and
   leaves no record.
4. Worker unit tests: all 404s byte-identical; admin without token is a 404; `PUT` with a 3 MiB body
   is rejected; TTL derived from `expiresAt`.
5. Manual, after deploy by the orchestrating session: create a share from a scratch conversation
   with the Worker configured, open the URL from the M5 (not the M4), confirm redaction and the
   generic `<title>`, revoke, confirm 404 within a minute, confirm the local listener is still not
   bound (`lsof` shows nothing).

## Open decisions for Jacob

1. **Public origin for shares.** Decided 2026-10-24: external publish to a Cloudflare Worker
   (ADR-1); no Funnel, no `tailscale serve` change. The earlier "already-enabled `:8443`" idea was
   wrong: that port serves the Hermes status bridge, and `:443` carries a stale route. Remaining
   sub-decision: keep the `*.workers.dev` hostname or add a custom domain later.
2. **Owner display name** for guests: "Jacob", "Jacob Cole", or something else.
3. **Default expiry**: proposed 7 days. "Never" stays available.
4. **Live mode in Phase 1 or 1b**: proposed 1b to keep the first PR reviewable.
5. **Phase 2 identity**: Ideaflow ID is assumed. Confirm Brenda can hold an Ideaflow ID account,
   or whether a per-share magic link (email-verified, no account) should be the first collaborator
   path instead.

## Risks and mitigations

- **Redaction false negatives.** Pattern scrubbing cannot catch every secret. Mitigation: tool output
  and reasoning are hidden structurally, not by pattern; the preview is exact; secrets rarely appear
  in prose. Documented as a known limit on the guest page footer ("shared view, tool activity
  hidden").
- **Exposing a listener on the owner's machine.** Mitigated by the separate app with zero daemon
  routes, 404-for-everything, no cookies in Phase 1, strict headers, rate limiting, and a
  `sharesDir`-only read path. Still an operator decision (open decision 1).
- **Token in reverse-proxy logs.** Accepted; documented; revocation is one tap.
- **Live mode load.** Re-projecting on each view is bounded to 500 items and rate limited; snapshots
  are the default.
- **Protocol drift.** All additions optional; one gate; no fallback path; `COMPAT` tagged.

## As built (Phase 1)

Phase 1 implements snapshot links only (`pspin-twk.2`). [QA evidence](../qa/conversation-sharing-phase1/README.md) records source and browser checks. Configuration instructions live in
[public configuration](../../public-docs/configuration.md#conversation-share-links-paseo-fork).

Differences from the proposal:

- Preview/create carry an optional content digest. If the source changed, create rejects and
  refreshes the preview so the owner can review the new content before publishing.
- Included tool calls use fixed tool-category labels rather than provider-supplied names or
  summaries: provider strings can contain arguments, paths or output.
- The app preview displays the snapshot's text directly, including Markdown source. The guest
  page renders Markdown with the app's existing `markdown-it` version, raw HTML and images
  disabled. This keeps the preview free of remote image loads and rich tool rendering.
- The guest page needs no JavaScript. Its inline stylesheet is authorized by an exact CSP hash;
  all other sources are blocked. This avoids extra public routes or a weaker inline-style policy.
- Share change events require an advertised client capability and an owned event subscription,
  keeping new event types away from old clients. Delete emits the deleted id as well.
- Guest rate limits use the socket peer's IP, without trusting forwarded headers. A reverse proxy
  must enforce external per-client limits; the listener also bounds its in-memory IP table.
- Manage shares for the whole host lives under host connection settings. Snapshot redaction
  cannot be updated; create another link. Title and expiry remain editable through the typed API.
  The Shared badge ignores expired links because they no longer grant guest access.

Mobile system-share behavior is implemented through React Native's Share API. Source tests and
compact browser screenshots do not establish physical iOS/Android acceptance; the release owner
still needs the prepared-build checks 21–22 above. No listener was installed or published during
implementation.
