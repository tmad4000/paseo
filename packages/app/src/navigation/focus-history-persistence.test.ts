import { describe, expect, it } from "vitest";
import { createNavigationFocusHistory, type WorkspaceFocusLocation } from "./focus-history";
import type { FocusHistoryStorage } from "./focus-history-storage";

function workspace(id: string): WorkspaceFocusLocation {
  return {
    kind: "workspace",
    serverId: "host",
    workspaceId: id,
    paneId: "main",
    tabId: id,
    target: { kind: "agent", agentId: id },
    view: { panel: "agent", explorerTab: "changes" },
  };
}

function memoryStorage() {
  let value: string | null = null;
  return {
    read: async () => value,
    write: async (next: string) => {
      value = next;
    },
  };
}

describe("persisted focus history", () => {
  it("keeps Back and Forward order through a cold restart", async () => {
    const storage = memoryStorage();
    const history = createNavigationFocusHistory({ storage });
    await history.hydrate();
    for (const id of ["a", "b", "c", "d"]) history.record(workspace(id));
    expect(history.back(2)).toEqual(workspace("b"));
    history.record(workspace("b"));
    await history.flushPersistence();

    const restarted = createNavigationFocusHistory({ storage });
    await restarted.hydrate();
    restarted.record(workspace("b"));
    expect(restarted.getSnapshot()).toMatchObject({
      current: workspace("b"),
      backEntries: [workspace("a")],
      forwardEntries: [workspace("c"), workspace("d")],
      canGoBack: true,
      canGoForward: true,
      restoring: false,
    });
    expect(restarted.forward()).toEqual(workspace("c"));
    restarted.record(workspace("c"));
    expect(restarted.back(2)).toEqual(workspace("a"));
  });

  it("loads saved history before recording a visit made during hydration", async () => {
    const storage = memoryStorage();
    const history = createNavigationFocusHistory({ storage });
    await history.hydrate();
    history.record(workspace("a"));
    history.record(workspace("b"));
    await history.flushPersistence();
    const saved = await storage.read();
    let finishRead: (value: string | null) => void = () => {
      throw new Error("read not started");
    };
    const delayedStorage: FocusHistoryStorage = {
      ...storage,
      read: () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    };
    const restarted = createNavigationFocusHistory({ storage: delayedStorage });
    const hydration = restarted.hydrate();
    expect(restarted.hydrate()).toBe(hydration);
    restarted.record(workspace("c"));
    expect(restarted.back()).toBeNull();
    expect(await storage.read()).toBe(saved);
    finishRead(saved);
    await hydration;
    expect(restarted.getSnapshot()).toMatchObject({
      hydrated: true,
      current: workspace("c"),
      backEntries: [workspace("b"), workspace("a")],
    });
  });

  it("does not turn restored panel defaults into a new visit or discard Forward", async () => {
    const storage = memoryStorage();
    const history = createNavigationFocusHistory({ storage });
    await history.hydrate();
    history.record(workspace("a"));
    history.record(workspace("b"));
    history.back();
    history.record(workspace("a"));
    await history.flushPersistence();
    const restarted = createNavigationFocusHistory({ storage });
    await restarted.hydrate();
    const visible = {
      ...workspace("a"),
      paneId: "rebuilt-pane",
      view: { panel: "file-explorer", explorerTab: "files" },
    } satisfies WorkspaceFocusLocation;
    restarted.record(visible);
    expect(restarted.getSnapshot()).toMatchObject({
      current: visible,
      backEntries: [],
      forwardEntries: [workspace("b")],
    });
    // A later deliberate panel change is still a visit.
    restarted.record(workspace("a"));
    expect(restarted.back()).toEqual(visible);
  });

  it("keeps the last confirmed location if the app exits during a history jump", async () => {
    const storage = memoryStorage();
    const history = createNavigationFocusHistory({ storage });
    await history.hydrate();
    history.record(workspace("a"));
    history.record(workspace("b"));
    history.back();
    await history.flushPersistence();
    const restarted = createNavigationFocusHistory({ storage });
    await restarted.hydrate();
    expect(restarted.getSnapshot()).toMatchObject({
      current: workspace("b"),
      backEntries: [workspace("a")],
      restoring: false,
    });
    expect(restarted.back()).toEqual(workspace("a"));
  });

  it("persists removal of closed empty tabs and reset", async () => {
    const storage = memoryStorage();
    const history = createNavigationFocusHistory({ storage });
    await history.hydrate();
    history.record(workspace("a"));
    history.record({ ...workspace("empty"), target: { kind: "new_tab" } });
    history.record(workspace("b"));
    history.forgetTab("host", "empty", "empty");
    await history.flushPersistence();
    const restarted = createNavigationFocusHistory({ storage });
    await restarted.hydrate();
    expect(restarted.getSnapshot().backEntries).toEqual([workspace("a")]);
    restarted.reset();
    await restarted.flushPersistence();
    const empty = createNavigationFocusHistory({ storage });
    await empty.hydrate();
    expect(empty.getSnapshot()).toMatchObject({
      current: null,
      backEntries: [],
      forwardEntries: [],
    });
  });

  it.each([
    "{",
    JSON.stringify({ version: 999, current: null, past: [], future: [] }),
    JSON.stringify({
      version: 1,
      current: null,
      past: [{ kind: "workspace", target: { kind: "unknown" } }],
      future: [],
    }),
  ])("recovers from invalid stored history: %s", async (stored) => {
    const storage = memoryStorage();
    await storage.write(stored);
    const history = createNavigationFocusHistory({ storage });
    await history.hydrate();
    history.record(workspace("a"));
    history.record(workspace("b"));
    expect(history.back()).toEqual(workspace("a"));
  });

  it("bounds both stacks when loading and preserves app-wide routes", async () => {
    const storage = memoryStorage();
    await storage.write(
      JSON.stringify({
        version: 1,
        current: workspace("b"),
        past: [workspace("old"), workspace("a"), { kind: "route", pathname: "/settings/general" }],
        future: [workspace("old-future"), workspace("d"), workspace("c")],
      }),
    );
    const history = createNavigationFocusHistory({ storage, maxLength: 2 });
    await history.hydrate();
    expect(history.getSnapshot()).toMatchObject({
      backEntries: [{ kind: "route", pathname: "/settings/general" }, workspace("a")],
      forwardEntries: [workspace("c"), workspace("d")],
    });
  });

  it("serializes writes so an older slow save cannot replace the newest history", async () => {
    let releaseFirst: () => void = () => {
      throw new Error("write not started");
    };
    const storage = memoryStorage();
    const values: string[] = [];
    const slowStorage: FocusHistoryStorage = {
      ...storage,
      write: async (value) => {
        values.push(value);
        if (values.length === 1)
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        await storage.write(value);
      },
    };
    const history = createNavigationFocusHistory({ storage: slowStorage });
    await history.hydrate();
    history.record(workspace("a"));
    history.record(workspace("b"));
    await Promise.resolve();
    expect(values).toHaveLength(1);
    releaseFirst();
    await history.flushPersistence();
    const restarted = createNavigationFocusHistory({ storage });
    await restarted.hydrate();
    expect(restarted.getSnapshot()).toMatchObject({
      current: workspace("b"),
      backEntries: [workspace("a")],
    });
  });

  it("keeps navigation usable after storage read and write failures", async () => {
    const storage = memoryStorage();
    let writeCount = 0;
    const unavailableStorage: FocusHistoryStorage = {
      read: async () => {
        throw new Error("Storage unavailable");
      },
      write: async (value) => {
        writeCount += 1;
        if (writeCount === 1) throw new Error("Storage quota reached");
        await storage.write(value);
      },
    };
    const history = createNavigationFocusHistory({ storage: unavailableStorage });
    await history.hydrate();
    history.record(workspace("a"));
    history.record(workspace("b"));
    await history.flushPersistence();
    expect(history.back()).toEqual(workspace("a"));
    history.record(workspace("a"));
    expect(history.forward()).toEqual(workspace("b"));
    history.record(workspace("b"));
    await history.flushPersistence();
    const restarted = createNavigationFocusHistory({ storage });
    await restarted.hydrate();
    expect(restarted.getSnapshot()).toMatchObject({
      current: workspace("b"),
      backEntries: [workspace("a")],
    });
  });
});
