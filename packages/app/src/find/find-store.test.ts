import { beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.fn(async () => 1);
const stop = vi.fn(async () => true);

vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({ find: { start, stop } }),
}));

const { useFindStore } = await import("@/find/find-store");

function reset(): void {
  start.mockClear();
  stop.mockClear();
  useFindStore.setState({ isOpen: false, query: "", matches: 0, activeMatch: 0 });
}

describe("find store", () => {
  beforeEach(reset);

  it("restarts the search from the top on every keystroke", () => {
    useFindStore.getState().setQuery("art");

    expect(useFindStore.getState().query).toBe("art");
    // findNext:false is what makes typing re-search rather than walk forward
    // through matches one character at a time.
    expect(start).toHaveBeenCalledWith({ query: "art", forward: true, findNext: false });
  });

  it("steps forward and backward through matches without changing the query", () => {
    useFindStore.getState().setQuery("art");
    start.mockClear();

    useFindStore.getState().findNext();
    expect(start).toHaveBeenCalledWith({ query: "art", forward: true, findNext: true });

    useFindStore.getState().findPrevious();
    expect(start).toHaveBeenCalledWith({ query: "art", forward: false, findNext: true });

    expect(useFindStore.getState().query).toBe("art");
  });

  it("stops the search and clears counters when the query empties", () => {
    useFindStore.getState().setQuery("art");
    useFindStore.getState().applyResult({ matches: 4, activeMatch: 2 });

    useFindStore.getState().setQuery("");

    expect(stop).toHaveBeenCalled();
    expect(useFindStore.getState().matches).toBe(0);
    expect(useFindStore.getState().activeMatch).toBe(0);
  });

  it("re-runs an existing query when reopened so highlights come back", () => {
    useFindStore.getState().setQuery("art");
    useFindStore.getState().close();
    start.mockClear();

    useFindStore.getState().open();

    expect(useFindStore.getState().isOpen).toBe(true);
    expect(start).toHaveBeenCalledWith({ query: "art", forward: true, findNext: false });
  });

  it("clears counters on close but keeps the query for the next open", () => {
    useFindStore.getState().setQuery("art");
    useFindStore.getState().applyResult({ matches: 9, activeMatch: 3 });

    useFindStore.getState().close();

    expect(stop).toHaveBeenCalled();
    expect(useFindStore.getState().isOpen).toBe(false);
    expect(useFindStore.getState().matches).toBe(0);
    expect(useFindStore.getState().query).toBe("art");
  });
});
