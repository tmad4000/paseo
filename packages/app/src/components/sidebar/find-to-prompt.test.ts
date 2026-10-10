import { describe, expect, it, vi } from "vitest";
import {
  NoNewChatDestinationError,
  startChatFromFilterQuery,
  type StartChatFromFilterQueryDeps,
} from "./find-to-prompt";

function deps(overrides: Partial<StartChatFromFilterQueryDeps> = {}) {
  return {
    saveDraft: vi.fn(),
    flush: vi.fn(async () => {}),
    hasWorkspace: vi.fn(() => true),
    navigate: vi.fn(),
    createDraftId: () => "draft-1",
    ...overrides,
  } satisfies StartChatFromFilterQueryDeps;
}

const scratch = {
  serverId: "mini",
  workspaceId: "tmp-root",
  projectViewKey: "tmpworkspace",
  projectName: "tmpworkspace",
  name: "tmpworkspace",
  workspaceDirectory: "/Volumes/External_SSD/code/tmpworkspace",
  projectRootPath: "/Volumes/External_SSD/code/tmpworkspace",
};
const other = {
  ...scratch,
  workspaceId: "paseo",
  projectViewKey: "paseo",
  projectName: "paseo",
  name: "paseo",
  workspaceDirectory: "/code/paseo",
  projectRootPath: "/code/paseo",
};

describe("startChatFromFilterQuery", () => {
  it("drafts the trimmed query in the default workspace and opens it", async () => {
    const d = deps();
    await startChatFromFilterQuery(
      {
        query: "  relay reconnect  ",
        startAndOpen: false,
        workspaces: [other, scratch],
        serverIds: ["mini"],
        active: { serverId: "mini", workspaceId: "paseo" },
      },
      d,
    );
    expect(d.saveDraft).toHaveBeenCalledWith({
      serverId: "mini",
      draftId: "draft-1",
      text: "relay reconnect",
    });
    expect(d.flush).toHaveBeenCalledOnce();
    expect(d.navigate).toHaveBeenCalledWith({
      serverId: "mini",
      workspaceId: "tmp-root",
      target: { kind: "draft", draftId: "draft-1" },
    });
  });

  it("does nothing for a blank query and fails clearly without a destination", async () => {
    const blank = deps();
    await startChatFromFilterQuery(
      { query: "   ", startAndOpen: false, workspaces: [scratch], serverIds: ["mini"], active: null },
      blank,
    );
    expect(blank.saveDraft).not.toHaveBeenCalled();

    const none = deps();
    await expect(
      startChatFromFilterQuery(
        { query: "relay", startAndOpen: true, workspaces: [other], serverIds: ["mini"], active: null },
        none,
      ),
    ).rejects.toBeInstanceOf(NoNewChatDestinationError);
    expect(none.navigate).not.toHaveBeenCalled();
  });
});
