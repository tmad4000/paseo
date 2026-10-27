import { beforeEach, expect, it, vi } from "vitest";
const backing = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: backing }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

it("keeps an explicit Stream deep link when saved Chat selection hydrates later", async () => {
  let resolveRead!: (value: string) => void;
  backing.getItem.mockReturnValue(
    new Promise<string>((resolve) => {
      resolveRead = resolve;
    }),
  );
  const { useAgentViewStore } = await import("./agent-view-store");
  useAgentViewStore.getState().setSelectedView("host", "session", "artifacts");
  resolveRead(
    JSON.stringify({
      state: { selectedViews: { "host:session": "chat", "host:other": "artifacts" } },
      version: 0,
    }),
  );
  await vi.waitFor(() => expect(useAgentViewStore.persist.hasHydrated()).toBe(true));
  expect(useAgentViewStore.getState().getSelectedView("host", "session")).toBe("artifacts");
  expect(useAgentViewStore.getState().getSelectedView("host", "other")).toBe("artifacts");
});

it("restores the Stream selection after reload without persisting the Find overlay", async () => {
  backing.getItem.mockResolvedValue(
    JSON.stringify({ state: { selectedViews: { "host:session": "artifacts" } }, version: 0 }),
  );
  const { useAgentViewStore } = await import("./agent-view-store");
  await vi.waitFor(() => expect(useAgentViewStore.persist.hasHydrated()).toBe(true));
  expect(useAgentViewStore.getState().getSelectedView("host", "session")).toBe("artifacts");
  expect(useAgentViewStore.getState().findOpen).toEqual({});
});
