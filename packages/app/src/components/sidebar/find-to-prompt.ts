import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { flushDraftPersistStorageDurably, useDraftStore } from "@/stores/draft-store";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import {
  defaultNewConversationWorkspace,
  prepareNewConversationDraft,
  type NewConversationCandidate,
} from "./session-routing/new-conversation";
import { useSidebarModel } from "./sidebar-model";

/**
 * Find → prompt: turn what was typed in the sidebar filter into a new chat (docs/sidebar-filter.md).
 *
 * `startChatFromFilterQuery` is the ONE creation entry point for the filter's "Start a chat"
 * row and its Mod+Enter / Mod+Shift+Enter keys. Until Quick launch lands it uses the existing
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

const defaultDeps: StartChatFromFilterQueryDeps = {
  saveDraft: ({ serverId, draftId, text }) =>
    useDraftStore.getState().saveDraftInput({
      draftKey: buildDraftStoreKey({ serverId, agentId: draftId, draftId }),
      draft: { text, attachments: [] },
    }),
  flush: flushDraftPersistStorageDurably,
  hasWorkspace: ({ serverId, workspaceId }) =>
    useSessionStore.getState().sessions[serverId]?.workspaces.has(workspaceId) === true,
  navigate: navigateToWorkspace,
  createDraftId: generateDraftId,
};

export async function startChatFromFilterQuery(
  input: StartChatFromFilterQueryInput,
  deps: StartChatFromFilterQueryDeps = defaultDeps,
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

/** The filter's start-chat action, bound to the current query and sidebar hosts. */
export function useStartChatFromFilterQuery(onNavigate?: () => void) {
  const { t } = useTranslation();
  const toast = useToast();
  const { searchQuery, workspacePlacements, serverIds } = useSidebarModel();
  const active = useActiveWorkspaceSelection();
  return useCallback(
    (startAndOpen: boolean) => {
      if (!searchQuery.trim()) return;
      void (async () => {
        try {
          await startChatFromFilterQuery({
            query: searchQuery,
            startAndOpen,
            workspaces: workspacePlacements,
            serverIds,
            active,
          });
          onNavigate?.();
        } catch (error) {
          toast.error(
            error instanceof NoNewChatDestinationError
              ? t("sidebar.filterSidebar.matches.noChatDestination")
              : t("sidebar.filterSidebar.matches.startChatFailed"),
          );
        }
      })();
    },
    [active, onNavigate, searchQuery, serverIds, t, toast, workspacePlacements],
  );
}
