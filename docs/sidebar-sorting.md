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

## Reviewing sessions

Workspace sorting and tab order are separate. The horizontal tab strip keeps its saved pane order;
new tabs are inserted by the opening action and you can drag them. Completing a turn does not
move a tab under your pointer.

Each workspace has an inline Review preview naming up to three sessions with unread completions
or pending review markers. Expand for the rest or collapse the preview; collapse is saved on this
device. Each row opens that exact session. Search retains its existing title-match rows instead
of also showing the preview. A finished session remains discoverable when another session makes
the workspace's overall status Working.

Review rows use **AI’s last reply, newest first**, independently of workspace sorting. Only dated,
completed assistant replies establish that order; unknown historical times stay last. Reading,
renaming and changing a review label do not invent a completion timestamp. The top tabs keep their
arrangement. [The end-to-end review proposal](design/review-flow.html) compares additional queue
sorts and an optional review view within the existing sidebar; those controls remain proposals.

## Pinned projects

Pinned projects lead the project list in every sort mode, above a divider, the way pinned rows
keep their order. The Default project comes first, then the order you dragged pinned projects
into, then most recently pinned. That drag order is per device and separate from Manual order,
so dragging a pinned project never switches the sort mode. Pinned projects still collapse,
filter and list their workspaces like any other project. Pin state and the Default live on the
host's project record (`~/.paseo/projects/projects.json`), so the phone and desktop agree; the
actions hide on hosts that do not advertise `projectPinning`. Making a grouped project the
default applies it on each of its hosts; the host Workspaces settings page sets one host only.

The New workspace and Quick launch project pickers use the same order and pins: **Pinned** rows
first, then **Projects** (headers only while the search field is empty and both groups have
rows). The pin button on a picker row pins or unpins without selecting it; the Default shows its
house marker instead. Pins only reorder the picker; its initial project still comes from the
route or the last active project.

## Host compatibility

The message sorts work against every host. A host that predates `conversationMessageActivity` sends
no role clocks, so its chats sort by the legacy last-user-message time (falling back to creation
time), and the menu names each such host with its version ("Chats on SDMM770 (0.10.0-beta.11) sort
by approximate times"). Until a host's server info arrives, the saved sort applies to its cached
clocks and the menu shows no notice for it. The saved preference is never rewritten,
and the menu's checkmark and trigger label name it. This keeps a client that updates before its host
from losing the activity order it already had.
