import { expect, it } from "vitest";
import type { DaemonServerInfo } from "@/stores/session-store";
import { olderMessageSortHosts } from "./message-sort-capability";

function host(input: Partial<DaemonServerInfo>): { serverInfo: DaemonServerInfo } {
  return {
    serverInfo: { serverId: "srv", hostname: "SDMM770", version: "0.10.0-beta.11", ...input },
  };
}

it("names each host without message activity, with its version", () => {
  const state = {
    sessions: {
      m4: host({ features: {} }),
      bare: host({
        hostname: null,
        version: null,
        features: { conversationMessageActivity: false },
      }),
    },
  };
  expect(olderMessageSortHosts(state, ["m4", "bare"])).toEqual([
    "SDMM770 (0.10.0-beta.11)",
    "bare",
  ]);
});

it("skips hosts whose server info has not arrived and hosts that support message activity", () => {
  const state = {
    sessions: {
      pending: { serverInfo: null },
      current: host({ features: { conversationMessageActivity: true } }),
    },
  };
  expect(olderMessageSortHosts(state, ["pending", "current", "unpaired"])).toEqual([]);
});

it("lists a repeated label once", () => {
  const state = { sessions: { a: host({ features: {} }), b: host({ features: {} }) } };
  expect(olderMessageSortHosts(state, ["a", "b"])).toEqual(["SDMM770 (0.10.0-beta.11)"]);
});
