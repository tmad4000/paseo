# Moving aside chats

An agent tab's **Move to workspace…** menu is shared by desktop right-click and the mobile tab menu. Choose **Asides**, **New workspace…**, or an existing workspace on the same host. The move preserves the agent ID, provider session, transcript, Stream, queue, parent relationship and execution cwd. It changes workspace ownership only; it does not copy files or create a git branch.

The daemon serializes moves per registry, so concurrent clients reuse one Asides workspace identified by the `paseo:asides` label (renaming it does not lose the catch-all). Its first creation uses the host's Default project's directory if configured, otherwise the source workspace's directory. A new individual workspace shares the source directory and its worktree recovery/ownership metadata. A caller-supplied new-workspace ID makes retrying a lost reply idempotent. Stale source ownership and archived destinations are rejected.

The successful reply includes the moved agent and destination snapshots. The invoking client removes the source tab through layout actions, without invoking archive; the success toast opens the destination on request. Other clients reconcile from the directory stream. Foreign tabs already explicitly pinned in other layouts remain valid views.

A chat placed into a catch-all can still execute in its original directory. Worktree deletion therefore checks active stored agents in surviving workspaces, in addition to each workspace's own backing directory. Archiving the original workspace cannot delete that moved chat's working directory. The directory is kept conservatively until no active workspace/chat references it.

The client gates the action on `server_info.features.agentWorkspaceMove`; older hosts keep their existing tab actions. `agent.workspace.move.request/response` adds a new RPC without changing existing message parsing. Browser/window titles continue through the normal workspace/agent title pipeline.
