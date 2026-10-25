# First message

Choose **First message** from the workspace header’s **…** menu while a chat is active,
or run **First message** in the Command Center. It opens the original user prompt in an
`AdaptiveModalSheet`: a scrollable bottom sheet on compact layouts and a dialog on desktop.
It shows the full, selectable message and its date in the current locale. Dismissing it
leaves the transcript at its existing reading position. The action is available in both
Chat and Stream, including archived chats, and does not depend on hover or the desktop outline.

`packages/app/src/first-message/load.ts` reads the existing prompt index, then requests one
canonical timeline row at the first prompt's position. It uses the client directly rather
than the viewed-timeline synchronizer, so reading the prompt neither hydrates all older
history nor changes the transcript window. A timeline replacement between those requests
produces a retryable error instead of displaying another message as the first prompt.

The reader gates on `server_info.features.agentTimelinePromptIndex`. It shows an update
message on older hosts, loading while reading, an empty state before the first send, and
a visible error with Retry when a read fails. It reads again when reopened so an empty
chat or a rewound timeline cannot leave a stale first message cached. The source is the
host's retained timeline: an imported or truncated provider history can only show the
first user message still retained there. Attachment-only prompts display a no-text state.
