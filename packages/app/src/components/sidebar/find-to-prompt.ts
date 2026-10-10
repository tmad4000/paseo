import {
  defaultNewConversationWorkspace,
  prepareNewConversationDraft,
  type NewConversationCandidate,
} from "./session-routing/new-conversation";

/**
 * Find → prompt: turn what was typed in the sidebar filter into a new chat (docs/sidebar-filter.md).
 *
 * `startChatFromFilterQuery` is the ONE creation entry point for the filter's "Start a chat"
 * row and its Mod+Enter / Mod+Shift+Enter keys; `useStartChatFromFilterQuery` binds it to the app. Until Quick launch lands it uses the existing
 * New conversation handoff — a prefilled draft tab in the default workspace, which always opens,
 * so `startAndOpen` has no effect yet. When Quick launch merges, replace the body with its opener
 * (`openQuickLaunch({ prompt, startAndOpen })`), the same swap as the Default-project resolver.
 */
export class NoNewChatDestinationError extends Error {
  constructor() {
    super("No default workspace for new chats");
    this.name = "NoNewChatDestinationError";
  }
}

export interface StartChatFromFilterQueryInput {
  query: string;
  startAndOpen: boolean;
  workspaces: readonly NewConversationCandidate[];
  serverIds: readonly string[];
  active: { serverId: string; workspaceId: string } | null;
}

export interface StartChatFromFilterQueryDeps {
  saveDraft: (input: { serverId: string; draftId: string; text: string }) => void;
  flush: () => Promise<void>;
  hasWorkspace: (input: { serverId: string; workspaceId: string }) => boolean;
  navigate: Parameters<typeof prepareNewConversationDraft>[0]["navigate"];
  createDraftId: () => string;
}

export async function startChatFromFilterQuery(
  input: StartChatFromFilterQueryInput,
  deps: StartChatFromFilterQueryDeps,
): Promise<void> {
  const text = input.query.trim();
  if (!text) return;
  const workspace = defaultNewConversationWorkspace({
    workspaces: input.workspaces,
    serverIds: input.serverIds,
    scope: null,
    active: input.active,
  });
  if (!workspace) throw new NoNewChatDestinationError();
  await prepareNewConversationDraft({
    workspace,
    text,
    draftId: deps.createDraftId(),
    save: (draftId, draftText) =>
      deps.saveDraft({ serverId: workspace.serverId, draftId, text: draftText }),
    flush: deps.flush,
    isEligible: () => deps.hasWorkspace(workspace),
    navigate: deps.navigate,
  });
}
