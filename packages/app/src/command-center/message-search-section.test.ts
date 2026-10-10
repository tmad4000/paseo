import { describe, expect, it, vi } from "vitest";
import { buildMessageSearchSection } from "./message-search-section";
import {
  CONTRIBUTION_SECTION_BAND,
  PINNED_SECTION_BAND,
  type CommandCenterResultSection,
} from "./results";

function section(id: string, band: number, resultCount: number): CommandCenterResultSection {
  return {
    id,
    band,
    rank: 0,
    results: Array.from({ length: resultCount }, (_, index) => ({
      kind: "workspace" as const,
      id: `${id}:${index}`,
      title: "Workspace",
      subtitle: "",
      changeRequestNumber: null,
      run: () => {},
    })),
  };
}

describe("command center message search item", () => {
  it("appears only for a 3+ character query with no command or workspace hit", () => {
    const run = vi.fn();
    const build = (query: string, sections: CommandCenterResultSection[]) =>
      buildMessageSearchSection({ query, sections, title: `Search messages for "${query}"`, run });
    const agentsOnly = [
      section("actions", CONTRIBUTION_SECTION_BAND, 0),
      section("workspaces", PINNED_SECTION_BAND, 0),
      section("agents", PINNED_SECTION_BAND, 2),
    ];
    expect(build("re", agentsOnly)).toBeNull();
    expect(build("relay", [section("workspaces", PINNED_SECTION_BAND, 1)])).toBeNull();
    expect(build("relay", [section("actions", CONTRIBUTION_SECTION_BAND, 1)])).toBeNull();

    const item = build("  relay  ", agentsOnly);
    expect(item?.results).toHaveLength(1);
    void item!.results[0]!.run();
    expect(run).toHaveBeenCalledWith("relay");
  });
});
