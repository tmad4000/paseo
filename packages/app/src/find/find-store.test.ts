import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn((query: string) => (query === "art" ? 3 : 0));
const focusMatch = vi.fn();
const clear = vi.fn();

vi.mock("@/find/find-highlighter", () => ({
  getFindHighlighter: () => ({ search, focusMatch, clear }),
}));

const { useFindStore } = await import("@/find/find-store");

function reset(): void {
  search.mockClear();
  focusMatch.mockClear();
  clear.mockClear();
  useFindStore.setState({ isOpen: false, query: "", matches: 0, activeIndex: -1 });
}

describe("find store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces the scan so a burst of keystrokes costs one pass", () => {
    const store = useFindStore.getState();
    store.setQuery("a");
    store.setQuery("ar");
    store.setQuery("art");

    // Nothing has run yet — the whole point of the debounce.
    expect(search).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("art");
    expect(useFindStore.getState().matches).toBe(3);
    expect(useFindStore.getState().activeIndex).toBe(0);
  });

  it("clears immediately when the query empties rather than waiting", () => {
    useFindStore.getState().setQuery("art");
    vi.advanceTimersByTime(200);
    clear.mockClear();

    useFindStore.getState().setQuery("");

    expect(clear).toHaveBeenCalled();
    expect(useFindStore.getState().matches).toBe(0);
    expect(useFindStore.getState().activeIndex).toBe(-1);
  });

  it("wraps around when stepping past either end", () => {
    useFindStore.getState().setQuery("art");
    vi.advanceTimersByTime(200);

    useFindStore.getState().findNext();
    expect(useFindStore.getState().activeIndex).toBe(1);
    useFindStore.getState().findNext();
    expect(useFindStore.getState().activeIndex).toBe(2);
    useFindStore.getState().findNext();
    expect(useFindStore.getState().activeIndex).toBe(0);

    useFindStore.getState().findPrevious();
    expect(useFindStore.getState().activeIndex).toBe(2);
    expect(focusMatch).toHaveBeenLastCalledWith(2);
  });

  it("settles a pending scan before stepping, so it steps the current results", () => {
    useFindStore.getState().setQuery("art");
    // No timer advance: the debounce is still pending and matches is stale at 0.
    expect(useFindStore.getState().matches).toBe(0);

    useFindStore.getState().findNext();

    expect(search).toHaveBeenCalledWith("art");
    expect(useFindStore.getState().matches).toBe(3);
  });

  it("does nothing when stepping with no matches", () => {
    useFindStore.getState().setQuery("zzz");
    vi.advanceTimersByTime(200);
    focusMatch.mockClear();

    useFindStore.getState().findNext();

    expect(focusMatch).not.toHaveBeenCalled();
    expect(useFindStore.getState().activeIndex).toBe(-1);
  });

  it("drops a pending scan on close so it cannot fire after teardown", () => {
    useFindStore.getState().setQuery("art");
    useFindStore.getState().close();
    search.mockClear();

    vi.advanceTimersByTime(500);

    expect(search).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(useFindStore.getState().isOpen).toBe(false);
  });

  it("re-runs an existing query when reopened so highlights come back", () => {
    useFindStore.getState().setQuery("art");
    vi.advanceTimersByTime(200);
    useFindStore.getState().close();
    search.mockClear();

    useFindStore.getState().open();

    expect(search).toHaveBeenCalledWith("art");
    expect(useFindStore.getState().query).toBe("art");
  });
});
