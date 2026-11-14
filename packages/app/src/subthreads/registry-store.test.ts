import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createSubagentRegistryStore,
  REGISTRY_MAX_ENTRIES,
  registryChatKey,
  registryPaneKey,
} from "./registry-store";

function memoryStorage(initial: Record<string, string> = {}): StateStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => {
      data.set(name, value);
    },
    removeItem: (name) => {
      data.delete(name);
    },
  };
}

async function hydrated(storage: StateStorage) {
  const store = createSubagentRegistryStore(storage);
  await store.persist.rehydrate();
  return store;
}

describe("subagent registry store", () => {
  it("survives a reload: group and asks-section folds come back from storage", async () => {
    const storage = memoryStorage();
    const first = await hydrated(storage);
    const chat = registryChatKey("host", "orchestrator");
    const pane = registryPaneKey("host", "workspace", "tab-1", "orchestrator");
    first.getState().setGroupCollapsed(chat, "provider", false);
    first.getState().setGroupCollapsed(chat, "paseo", true);
    first.getState().setAsksSectionCollapsed(pane, false);

    const reloaded = await hydrated(storage);
    expect(reloaded.getState().groups[chat]).toEqual({ provider: false, paseo: true });
    expect(reloaded.getState().asksSections[pane]).toBe(false);
  });

  it("keys the asks section per pane, so the same chat in two splits keeps two choices", () => {
    const left = registryPaneKey("host", "workspace", "tab-left", "chat");
    const right = registryPaneKey("host", "workspace", "tab-right", "chat");
    const otherHost = registryPaneKey("other", "workspace", "tab-left", "chat");
    expect(new Set([left, right, otherHost]).size).toBe(3);
  });

  it("drops a stored value that does not match its schema instead of crashing", async () => {
    const storage = memoryStorage({
      "subagent-registry": JSON.stringify({ state: { groups: { x: { paseo: "yes" } } } }),
    });
    const store = await hydrated(storage);
    expect(store.getState().groups).toEqual({});
    expect(storage.data.has("subagent-registry")).toBe(false);
  });

  it("keeps the newest entries when the cap is reached", () => {
    const store = createSubagentRegistryStore(memoryStorage());
    for (let index = 0; index <= REGISTRY_MAX_ENTRIES; index += 1) {
      store.getState().setAsksSectionCollapsed(`pane-${index}`, true);
    }
    // Touching an old entry makes it the newest instead of letting it age out.
    store.getState().setAsksSectionCollapsed("pane-1", false);
    const keys = Object.keys(store.getState().asksSections);
    expect(keys).toHaveLength(REGISTRY_MAX_ENTRIES);
    expect(keys).not.toContain("pane-0");
    expect(keys.at(-1)).toBe("pane-1");
    expect(store.getState().asksSections["pane-1"]).toBe(false);
  });
});
