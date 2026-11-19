import { describe, expect, test, vi } from "vitest";
import { AGENT_FLEET_SUMMARY_VISIT_LIMIT } from "@getpaseo/protocol/messages";
import type { ManagedAgent } from "./agent-manager.js";
import { summarizeLoadedFleet } from "./agent-fleet-summary.js";

const rootId = "01a00000-0000-4000-8000-000000000001";

function fixture(
  lifecycle: ManagedAgent["lifecycle"],
  options: {
    internal?: boolean;
    pending?: number;
    attention?: "error" | "finished" | "permission";
  } = {},
) {
  return {
    lifecycle,
    internal: options.internal ?? false,
    pendingPermissions: {
      get size() {
        return options.pending ?? 0;
      },
    },
    attention: options.attention
      ? ({
          requiresAttention: true,
          attentionReason: options.attention,
          attentionTimestamp: new Date(),
        } as const)
      : ({ requiresAttention: false } as const),
  };
}

describe("loaded fleet summary", () => {
  test("classifies each eligible agent once, using current permission and lifecycle precedence", () => {
    const agents = new Map([
      [rootId, fixture("running", { pending: 3 })],
      ["permission-attention", fixture("initializing", { attention: "permission" })],
      ["permission-beats-error", fixture("error", { pending: 1 })],
      ["running-old-error", fixture("running", { attention: "error" })],
      ["idle-error", fixture("idle", { attention: "error" })],
      ["lifecycle-error", fixture("error")],
      ["idle-finished", fixture("idle", { attention: "finished" })],
      ["idle", fixture("idle")],
      ["initializing", fixture("initializing")],
      ["unsupported", fixture("future" as ManagedAgent["lifecycle"])],
      ["internal", fixture("running", { internal: true, pending: 1 })],
      ["closed", fixture("closed", { pending: 1 })],
    ]);

    expect(summarizeLoadedFleet(agents, rootId)).toMatchObject({
      availability: "ok",
      coverage: { seen: 10, total: 10, complete: true },
      counts: { running: 1, idle: 2, blocked: 2, needsPermission: 3, initializing: 1, unknown: 1 },
      root: { agentId: rootId, state: "needsPermission" },
      error: null,
    });
  });

  test("a fleet at the visit limit is complete, including an ineligible last entry", () => {
    const agents = new Map(
      Array.from({ length: AGENT_FLEET_SUMMARY_VISIT_LIMIT - 1 }, (_, i) => [
        String(i),
        fixture("idle"),
      ]),
    );
    agents.set(rootId, fixture("closed"));

    expect(summarizeLoadedFleet(agents, rootId)).toMatchObject({
      availability: "ok",
      coverage: { seen: 9_999, total: 9_999, complete: true },
      counts: { idle: 9_999 },
      root: { agentId: rootId, state: "unknown" },
    });
  });

  test("charges filtered entries against the cap and still resolves the exact root beyond it", () => {
    const agents = new Map(
      Array.from({ length: AGENT_FLEET_SUMMARY_VISIT_LIMIT }, (_, i) => [
        String(i),
        fixture("idle", { internal: i > 0 }),
      ]),
    );
    agents.set(rootId, fixture("running"));
    const iterator = agents[Symbol.iterator]();
    const next = vi.spyOn(iterator, "next");
    vi.spyOn(agents, Symbol.iterator).mockReturnValue(iterator);
    const get = vi.spyOn(agents, "get");

    expect(summarizeLoadedFleet(agents, rootId)).toMatchObject({
      availability: "partial",
      coverage: { seen: 1, total: null, complete: false },
      counts: { running: 0, idle: 1, blocked: 0, needsPermission: 0, initializing: 0, unknown: 0 },
      root: { agentId: rootId, state: "running" },
      error: null,
    });
    expect(next).toHaveBeenCalledTimes(AGENT_FLEET_SUMMARY_VISIT_LIMIT - 1);
    expect(get.mock.calls).toEqual([[rootId]]);
  });

  test("distinguishes a successful empty fleet from a source failure", () => {
    const agents = new Map<string, ReturnType<typeof fixture>>();
    expect(summarizeLoadedFleet(agents, rootId)).toMatchObject({
      availability: "ok",
      coverage: { seen: 0, total: 0, complete: true },
      counts: { running: 0, idle: 0, blocked: 0, needsPermission: 0, initializing: 0, unknown: 0 },
      root: { agentId: rootId, state: "unknown" },
      error: null,
    });

    const failing = fixture("running");
    vi.spyOn(failing.pendingPermissions, "size", "get").mockImplementation(() => {
      throw new Error("private source error");
    });
    agents.set("scanned-first", fixture("idle"));
    agents.set(rootId, failing);
    expect(summarizeLoadedFleet(agents, rootId)).toMatchObject({
      availability: "unavailable",
      coverage: { seen: 0, total: null, complete: false },
      counts: null,
      root: { agentId: rootId, state: "unknown" },
      error: "unavailable",
    });
  });
});
