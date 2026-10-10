import { useCallback } from "react";
import { startChatFromFilterQuery } from "./find-to-prompt";
import { useSidebarModel } from "./sidebar-model";

/**
 * The filter's start-chat action, bound to the current query. Opening Quick launch twice with the
 * same prompt does not duplicate it (`mergeQuickLaunchPrompt`), so a double click is harmless; the
 * find field still ignores key repeat so a held Mod+Enter does not reopen the dialog repeatedly.
 */
export function useStartChatFromFilterQuery() {
  const { searchQuery } = useSidebarModel();
  return useCallback(
    (startAndOpen: boolean) => {
      startChatFromFilterQuery({ query: searchQuery, startAndOpen });
    },
    [searchQuery],
  );
}
