import { expect, it } from "vitest";
import type { DaemonServerInfo } from "@/stores/session-store";
import { olderMessageSortHostLabel } from "./message-sort-capability";

function serverInfo(input: Partial<DaemonServerInfo>): DaemonServerInfo {
  return { serverId: "srv", hostname: "SDMM770", version: "0.10.0-beta.11", ...input };
}

it("names a connected host without message activity, with its version", () => {
  expect(olderMessageSortHostLabel("srv", serverInfo({ features: {} }))).toBe(
    "SDMM770 (0.10.0-beta.11)",
  );
  expect(
    olderMessageSortHostLabel(
      "srv",
      serverInfo({ hostname: null, version: null, features: { conversationMessageActivity: false } }),
    ),
  ).toBe("srv");
});

it("treats a host whose server info has not arrived as unknown, not older", () => {
  expect(olderMessageSortHostLabel("srv", null)).toBeNull();
  expect(olderMessageSortHostLabel("srv", undefined)).toBeNull();
});

it("lists no supporting host", () => {
  expect(
    olderMessageSortHostLabel("srv", serverInfo({ features: { conversationMessageActivity: true } })),
  ).toBeNull();
});
