import { beforeEach, describe, expect, it } from "vitest";
import { useAgentViewStore } from "./agent-view-store";

describe("agent view store stream focus", () => {
  beforeEach(() => {
    useAgentViewStore.setState({ selectedViews: {}, streamFocus: {} });
  });

  it("switches the chat to its Stream and records the entry to show", () => {
    useAgentViewStore.getState().openStreamEntry("s1", "a1", { entryId: "ask:x", query: "X" });
    const state = useAgentViewStore.getState();
    expect(state.getSelectedView("s1", "a1")).toBe("artifacts");
    expect(state.streamFocus["s1:a1"]).toMatchObject({ entryId: "ask:x", query: "X" });
    expect(state.getSelectedView("s1", "a2")).toBe("chat");
  });

  it("clears only the request that was applied, not a newer one", () => {
    const store = useAgentViewStore.getState();
    store.openStreamEntry("s1", "a1", { entryId: "ask:x", query: "X" });
    const first = useAgentViewStore.getState().streamFocus["s1:a1"]!.requestId;
    store.openStreamEntry("s1", "a1", { entryId: "ask:y", query: "Y" });
    store.clearStreamFocus("s1", "a1", first);
    expect(useAgentViewStore.getState().streamFocus["s1:a1"]?.entryId).toBe("ask:y");
    const second = useAgentViewStore.getState().streamFocus["s1:a1"]!.requestId;
    store.clearStreamFocus("s1", "a1", second);
    expect(useAgentViewStore.getState().streamFocus["s1:a1"]).toBeUndefined();
  });
});
