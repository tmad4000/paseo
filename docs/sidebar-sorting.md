# Sidebar conversation sorting

The sidebar offers Latest conversation activity (the default), Your last message, AI’s last reply, Manual order,
and Title A–Z. The chosen mode persists on this device. Select Manual order to arrange rows by dragging.
Pinned rows retain their saved order. Message sorts order unpinned rows within project/status
groups and order project groups by their newest eligible conversation. Ties retain stored
order, so renaming a tied row does not move it.

Latest conversation activity uses the newer of the last accepted user message and the last completed
assistant reply. Your last message uses only accepted user messages; AI’s last reply uses only
completed assistant replies. Queue submission is not delivery:
the user clock advances when the host accepts the actual prompt. Streaming tokens, tool output,
settings, and title changes do not advance either clock. System-injected notifications are excluded.
An assistant turn must finish with visible reply text to advance its clock; stale completions and
canceled or tool-only turns do not advance it. Workspace rows aggregate their eligible root agents,
using the same archived/child exclusions as workspace activity.

The daemon persists `messageActivity` role clocks independently of `updatedAt` and the older
`lastUserMessageAt` field. Snapshots, list/directory updates, and the client replica cache carry them.
History import uses only original provider message timestamps. Undated history and existing durable
timeline rows cannot be safely backfilled: some older rows were stamped at hydration time. These
remain unknown until authoritative dated history is refreshed or a new message arrives. If both
roles are unknown, Latest conversation activity falls back to creation time; Your last message
falls back to creation time when its user clock is unknown. AI’s last reply likewise falls back to
creation time when its assistant clock is unknown. A known original timestamp wins even
when it predates an imported conversation's creation time. Reopening, refreshing undated history,
or reconnecting does not synthesize new activity.

## Pinned projects

Pinned projects lead the project list in every sort mode, above a divider, the way pinned rows
keep their order. The Default project comes first, then the order you dragged pinned projects
into, then most recently pinned. That drag order is per device and separate from Manual order,
so dragging a pinned project never switches the sort mode. Pinned projects still collapse,
filter and list their workspaces like any other project. Pin state and the Default live on the
host's project record (`~/.paseo/projects/projects.json`), so the phone and desktop agree; the
actions hide on hosts that do not advertise `projectPinning`. Making a grouped project the
default applies it on each of its hosts; the host Workspaces settings page sets one host only.

## Host compatibility

The three message sorts are available once at least one selected host advertises
`conversationMessageActivity`. A connected older host no longer disables them for every host: its
chats sort by the legacy last-user-message time (falling back to creation time), and the menu shows a
notice that some hosts need an update. Until server info arrives, or when every connected host is
older, the sidebar uses stored manual order, shows the update notice in the latter case, and disables
the message choices. The menu's checkmark and trigger label always name the order actually applied;
the saved preference is never rewritten and is restored as soon as a supporting host appears.
Manual and Title remain available throughout.
