import type { CommandCenterIcon } from "./contributions";
import {
  CONTRIBUTION_SECTION_BAND,
  PINNED_SECTION_BAND,
  type CommandCenterResultSection,
} from "./results";

export const MESSAGE_SEARCH_MIN_QUERY = 3;

/**
 * "Search messages for "<q>"": the command center's way into message text. It does not search
 * anything itself — it hands the query to the sidebar filter with the Names + messages scope
 * (docs/sidebar-filter.md), so there is one full-text UI, not two.
 *
 * Offered only when the query found no command and no workspace; a query that already lands on
 * one should keep Enter on it.
 */
export function buildMessageSearchSection(input: {
  query: string;
  sections: readonly CommandCenterResultSection[];
  title: string;
  icon?: CommandCenterIcon;
  run: (query: string) => void;
}): CommandCenterResultSection | null {
  const query = input.query.trim();
  if (query.length < MESSAGE_SEARCH_MIN_QUERY) return null;
  const hasCommandOrWorkspace = input.sections.some(
    (section) =>
      (section.band === CONTRIBUTION_SECTION_BAND || section.id === "workspaces") &&
      section.results.length > 0,
  );
  if (hasCommandOrWorkspace) return null;
  return {
    id: "message-search",
    band: PINNED_SECTION_BAND,
    rank: 5,
    results: [
      {
        kind: "contribution",
        id: "message-search",
        contribution: {
          id: "message-search",
          group: "message-search",
          groupRank: 0,
          rank: 0,
          keywords: [],
          visibility: "query",
          run: () => input.run(query),
          presentation: { kind: "action", title: input.title, icon: input.icon },
        },
        run: () => input.run(query),
      },
    ],
  };
}
