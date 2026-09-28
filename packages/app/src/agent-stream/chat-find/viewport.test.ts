import { describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import { createNativeFindViewport } from "./viewport";

function userMessage(id: string, text: string): StreamItem {
  return {
    kind: "user_message",
    id,
    messageId: id,
    text,
    timestamp: new Date(0),
  } as unknown as StreamItem;
}

describe("createNativeFindViewport", () => {
  it("mounts, scrolls to and counts the selected message", async () => {
    const scrollToMessage = vi.fn();
    const visible = new Set<string>();
    const revealLoadedMessage = vi.fn((messageId: string) => {
      visible.add(messageId);
      return true;
    });
    const viewport = createNativeFindViewport({
      getBindings: () => ({
        viewportRef: { current: { scrollToMessage } as unknown as StreamViewportHandle },
        revealLoadedMessage,
        visibleMessageIds: visible,
        items: [userMessage("m1", "fix the tests, then fix the docs")],
      }),
    });
    const result = await viewport.reveal("m1", "fix", -1, new AbortController().signal);
    expect(revealLoadedMessage).toHaveBeenCalledWith("m1");
    expect(scrollToMessage).toHaveBeenCalledWith("m1");
    expect(result).toEqual({ occurrence: 1, count: 2 });
  });

  it("reports zero when the text no longer contains the query", async () => {
    const viewport = createNativeFindViewport({
      getBindings: () => ({
        viewportRef: { current: null },
        revealLoadedMessage: () => true,
        visibleMessageIds: new Set(["m1"]),
        items: [userMessage("m1", "nothing here")],
      }),
    });
    await expect(
      viewport.reveal("m1", "missing", 0, new AbortController().signal),
    ).resolves.toEqual({ occurrence: 0, count: 0 });
  });

  it("rejects when the search is cancelled while waiting for the row", async () => {
    const controller = new AbortController();
    const viewport = createNativeFindViewport({
      getBindings: () => ({
        viewportRef: { current: null },
        revealLoadedMessage: () => false,
        visibleMessageIds: new Set(),
        items: [],
      }),
    });
    const reveal = viewport.reveal("m1", "x", 0, controller.signal);
    controller.abort();
    await expect(reveal).rejects.toThrow("Search cancelled");
  });
});
