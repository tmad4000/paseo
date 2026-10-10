# Quick launch

Quick launch starts a new agent session from a dialog without leaving the current one. The user
stays on their tab, the dialog closes as soon as Start is pressed, and a toast reports the result.

Code: `packages/app/src/quick-launch/`. The host (`host.tsx`) is mounted once in
`app/_layout.tsx` and owns the shortcut, the dialog, the creation request, and the toasts.

## Entry points

All of them open the same dialog through `openQuickLaunch({ prompt?, destination?, startAndOpen? })`
(`quick-launch/store.ts`). Other UI that wants to start a chat calls it rather than creating
agents itself. `destination` is a project (opens on New workspace in it) or a workspace (opens on
New tab in it); omitted, the default destination applies. `startAndOpen` makes Start and open the
accent action. The user always confirms in the dialog.

- **Mod+Shift+L** (`quick-launch.open`, rebindable). Shift+N is the desktop New Window
  accelerator, and Mod+L already focuses the composer. The binding fires from text inputs on
  purpose: starting work from inside another chat's composer is the main use.
- Command center: **Quick launch agent…**.
- The **Quick launch** sidebar item, a builtin in `sidebar-nav/model.ts`. Builtins that arrive
  after people saved an order slot in after their anchor (`BUILTIN_INSERT_AFTER`) instead of
  trailing the list.
- The sidebar router's Send mode with **New conversation** selected: **Start without leaving**
  hands the prompt and the chosen workspace to Quick launch as a prefill. The prompt moves; it is
  cleared from the router so it cannot also be continued there. See
  [session routing](session-routing.md#new-conversation-and-delivery-mode).
- The sidebar find field's **Start a chat with "&lt;query&gt;"** row, which passes the query as
  `prompt`.

## Destination

The dialog offers a project (and a host when more than one host is configured) and **Where**:
**New workspace** or **New tab in &lt;workspace&gt;**. The tab option appears when there is an
active workspace, or a prefilled one from the router.

The default project comes from `resolveQuickLaunchDefaultDestination`
(`quick-launch/destination.ts`) and nowhere else. It runs New conversation's scratch heuristic
at project granularity, then falls back to the active workspace's project. When the Default
project setting lands, it replaces the scratch lookup inside that one function. Nothing
remembers a previous choice: a changed destination applies to that launch only.

A new workspace uses the remembered Isolation choice from the New workspace screen, so a git
project creates a worktree exactly when New workspace would.

## Creation

`runQuickLaunch` (`quick-launch/launch.ts`) issues exactly one create request per Start:

- New workspace: `createProjectWorkspace` (`screens/new-workspace/create-workspace.ts`, shared
  with the New workspace screen) with the first agent in the same create_workspace request.
- New tab: `requestWorkspaceDraftAgent`, the same create_agent call a workspace draft tab makes.

The daemon does not dedupe create_agent by `clientMessageId`, so Quick launch never writes the
draft-submission or create-flow stores that make a workspace draft tab auto-submit. The new tab
opens on its own through `reconcileTabs`. Agent controls come from the shared create-agent
preferences, and Start persists the chosen provider and model the way New workspace does.

## Draft and focus

The prompt is the `quick-launch` draft in the draft store, so closing the dialog keeps it for the
next open and Start clears it. A failed start puts the prompt back unless a newer draft exists,
and its toast's **Retry** reopens the dialog on the same destination. Closing returns focus to
the element that had it before opening; when opened from the command center, that is the element
the command center would have restored.

The dialog never navigates. **Start and open** (Mod+Shift+Enter) navigates to the new agent only
after it exists. **Start** (Mod+Enter) shows a toast with **Open**.

Attachments are not supported yet.
