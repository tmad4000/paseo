import { describe, expect, it, vi } from "vitest";
import type { QuickLaunchRequest } from "@/quick-launch/store";
import { startChatFromFilterQuery } from "./find-to-prompt";

describe("startChatFromFilterQuery", () => {
  it("opens Quick launch with the trimmed query and no destination", () => {
    const open = vi.fn<(request: QuickLaunchRequest) => void>();
    expect(startChatFromFilterQuery({ query: "  relay reconnect  ", startAndOpen: false }, open)).toBe(
      true,
    );
    expect(open).toHaveBeenCalledWith({ prompt: "relay reconnect", startAndOpen: false });
    expect(open.mock.calls[0]![0]).not.toHaveProperty("destination");
  });

  it("preselects Start and open for Mod+Shift+Enter", () => {
    const open = vi.fn<(request: QuickLaunchRequest) => void>();
    startChatFromFilterQuery({ query: "relay", startAndOpen: true }, open);
    expect(open).toHaveBeenCalledWith({ prompt: "relay", startAndOpen: true });
  });

  it("does nothing for a blank query", () => {
    const open = vi.fn<(request: QuickLaunchRequest) => void>();
    expect(startChatFromFilterQuery({ query: "   ", startAndOpen: false }, open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
