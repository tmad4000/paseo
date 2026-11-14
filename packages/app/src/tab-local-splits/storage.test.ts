import { describe, expect, it } from "vitest";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { WorkspaceLayoutPersistedStateSchema } from "@/stores/workspace-layout-storage";
import {
  TAB_LOCAL_SPLITS_PERSIST_VERSION,
  TAB_LOCAL_SPLITS_STORAGE_KEY,
  TabLocalSplitsPersistedStateSchema,
  type TabLocalSplitsPersistedState,
} from "@/tab-local-splits/storage";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: async (key: string) => {
      items.delete(key);
    },
  };
}

const PERSISTED: TabLocalSplitsPersistedState = {
  layoutsByWorkspace: {
    "host-1:ws-1": {
      agent_a: {
        hostTabId: "agent_a",
        focusedLeafId: "terminal_t",
        root: {
          kind: "group",
          id: "g1",
          direction: "horizontal",
          sizes: [0.6, 0.4],
          children: [
            { kind: "leaf", tabId: "agent_a" },
            {
              kind: "group",
              id: "g2",
              direction: "vertical",
              sizes: [0.5, 0.5],
              children: [
                { kind: "leaf", tabId: "terminal_t" },
                { kind: "chooser", id: "chooser:1" },
              ],
            },
          ],
        },
      },
    },
  },
};

describe("tab-local-splits persisted schema", () => {
  it("round-trips through the validated persist storage", async () => {
    const backing = memoryStorage();
    const storage = createValidatedPersistStorage(backing, TabLocalSplitsPersistedStateSchema);
    await storage.setItem(TAB_LOCAL_SPLITS_STORAGE_KEY, {
      state: PERSISTED,
      version: TAB_LOCAL_SPLITS_PERSIST_VERSION,
    });
    expect(await storage.getItem(TAB_LOCAL_SPLITS_STORAGE_KEY)).toEqual({
      state: PERSISTED,
      version: 1,
    });
  });

  it("is strict: an unknown key is rejected", () => {
    expect(
      TabLocalSplitsPersistedStateSchema.safeParse({ ...PERSISTED, zoomedLeafByComposite: {} })
        .success,
    ).toBe(false);
    const layout = PERSISTED.layoutsByWorkspace["host-1:ws-1"]?.agent_a;
    expect(
      TabLocalSplitsPersistedStateSchema.safeParse({
        layoutsByWorkspace: { "host-1:ws-1": { agent_a: { ...layout, zoomed: true } } },
      }).success,
    ).toBe(false);
  });

  it("downgrade: a v2 workspace layout blob holding the members parses unchanged", () => {
    // What an older build reads: the members are ordinary tabs in the pane, and nothing about
    // the composite lives in `workspace-layout-state`, so its strict schema accepts the blob.
    const tab = (tabId: string, target: Record<string, string>) => ({
      tabId,
      target,
      createdAt: 1,
    });
    const blob = {
      layoutByWorkspace: {
        "host-1:ws-1": {
          root: {
            kind: "pane",
            pane: {
              id: "main",
              tabIds: ["agent_a", "terminal_t"],
              focusedTabId: "agent_a",
              tabs: [
                tab("agent_a", { kind: "agent", agentId: "a" }),
                tab("terminal_t", { kind: "terminal", terminalId: "t" }),
              ],
            },
          },
          focusedPaneId: "main",
        },
      },
      pinnedAgentIdsByWorkspace: {},
      splitSizesByWorkspace: {},
    };
    const parsed = WorkspaceLayoutPersistedStateSchema.safeParse(blob);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(blob);
  });
});
