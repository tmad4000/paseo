import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { answersPaneKey, createAnswersPaneStore } from "./answers-pane-store";

function memoryStorage(initial?: object): StateStorage {
  const values = new Map<string, string>();
  if (initial) values.set("answers-pane", JSON.stringify(initial));
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  };
}

describe("answers pane preferences", () => {
  it("remembers independent choices for the same chat in different tabs and hosts after reload", async () => {
    const storage = memoryStorage();
    const store = createAnswersPaneStore(storage);
    await store.persist.rehydrate();
    const first = answersPaneKey("host", "workspace", "tab-one", "chat");
    const split = answersPaneKey("host", "workspace", "tab-two", "chat");
    const otherHost = answersPaneKey("other-host", "workspace", "tab-one", "chat");
    const otherChat = answersPaneKey("host", "workspace", "tab-one", "other-chat");
    store.getState().setMinimized(first, true);
    store.getState().setMinimized(split, false);
    store.getState().setMinimized(otherHost, false);
    await store.persist.rehydrate();
    const reopened = createAnswersPaneStore(storage);
    await reopened.persist.rehydrate();
    expect(reopened.getState().minimizedByPane).toEqual({
      [first]: true,
      [split]: false,
      [otherHost]: false,
    });
    expect(reopened.getState().minimizedByPane[otherChat]).toBeUndefined();
    expect(reopened.getState().minimized).toBeNull();
  });

  it("preserves an old global choice as a fallback without coupling new choices", async () => {
    const storage = memoryStorage({ state: { minimized: true }, version: 0 });
    const store = createAnswersPaneStore(storage);
    await store.persist.rehydrate();
    store.getState().setMinimized("one", false);
    const reopened = createAnswersPaneStore(storage);
    await reopened.persist.rehydrate();
    expect(reopened.getState().minimized).toBe(true);
    expect(reopened.getState().minimizedByPane).toEqual({ one: false });
  });
});
