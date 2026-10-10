import { useCallback, useRef } from "react";
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
  NoNewChatDestinationError,
  startChatFromFilterQuery,
  type StartChatFromFilterQueryDeps,
} from "./find-to-prompt";
import { useSidebarModel } from "./sidebar-model";

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

/** The filter's start-chat action, bound to the current query and sidebar hosts. */
export function useStartChatFromFilterQuery(onNavigate?: () => void) {
  const { t } = useTranslation();
  const toast = useToast();
  const { searchQuery, workspacePlacements, serverIds } = useSidebarModel();
  const active = useActiveWorkspaceSelection();
  // A double click or a second Mod+Enter while the first draft is still being prepared must not
  // create a second prefilled draft.
  const inFlight = useRef(false);
  return useCallback(
    (startAndOpen: boolean) => {
      if (!searchQuery.trim() || inFlight.current) return;
      inFlight.current = true;
      void (async () => {
        try {
          await startChatFromFilterQuery(
            {
              query: searchQuery,
              startAndOpen,
              workspaces: workspacePlacements,
              serverIds,
              active,
            },
            defaultDeps,
          );
          onNavigate?.();
        } catch (error) {
          toast.error(
            error instanceof NoNewChatDestinationError
              ? t("sidebar.filterSidebar.matches.noChatDestination")
              : t("sidebar.filterSidebar.matches.startChatFailed"),
          );
        } finally {
          inFlight.current = false;
        }
      })();
    },
    [active, onNavigate, searchQuery, serverIds, t, toast, workspacePlacements],
  );
}
