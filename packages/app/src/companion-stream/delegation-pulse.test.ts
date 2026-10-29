import { describe, expect, it } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { Agent } from "@/stores/session-store";
import {
  delegationAttentionKey,
  delegationTarget,
  deriveDelegationPulse,
  selectDelegatedHere,
  toDelegationChildSnapshot,
  type DelegationChildSnapshot,
} from "./delegation-pulse";

type Ask = NonNullable<CompanionEntry["ask"]>;

const ask = (overrides: Partial<Ask> = {}): Ask => ({
  state: "in_progress",
  remaining: "",
  evidence: "",
  revision: 1,
  provenance: "explicit",
  ...overrides,
});

const child = (overrides: Partial<DelegationChildSnapshot> = {}): DelegationChildSnapshot => ({
  status: "idle",
  pendingPermissionCount: 0,
  attentionReason: null,
  turnStartedAt: null,
  lastActivityAt: 1_000,
  archived: false,
  title: "Worker",
  lastError: null,
  ...overrides,
});

describe("deriveDelegationPulse", () => {
  it("counts a running child from its turn start and needs nothing", () => {
    expect(deriveDelegationPulse(child({ status: "running", turnStartedAt: 500 }))).toMatchObject({
      kind: "running",
      needsAttention: false,
      since: 500,
    });
    // An open turn is running even before the status catches up.
    expect(deriveDelegationPulse(child({ turnStartedAt: 700 })).kind).toBe("running");
  });

  it("treats an idle child as an open loop for the delegator, not a finished ask", () => {
    expect(deriveDelegationPulse(child())).toMatchObject({
      kind: "idle",
      needsAttention: true,
      since: 1_000,
    });
  });

  it("orders closed, then permission, then error ahead of running", () => {
    expect(deriveDelegationPulse(child({ status: "running", archived: true })).kind).toBe("closed");
    expect(deriveDelegationPulse(child({ status: "closed" })).kind).toBe("closed");
    expect(
      deriveDelegationPulse(child({ status: "running", pendingPermissionCount: 2 })).kind,
    ).toBe("permission");
    expect(deriveDelegationPulse(child({ attentionReason: "permission" })).kind).toBe("permission");
    const failed = deriveDelegationPulse(child({ status: "error", lastError: " boom " }));
    expect(failed).toMatchObject({ kind: "error", needsAttention: true });
    expect(deriveDelegationPulse(child({ status: "initializing" }))).toMatchObject({
      kind: "starting",
      needsAttention: false,
    });
  });

  it("reports unknown, without attention, when this client has no snapshot", () => {
    expect(deriveDelegationPulse(null)).toMatchObject({ kind: "unknown", needsAttention: false });
  });
});

describe("toDelegationChildSnapshot", () => {
  it("reads only what the pulse needs from a store agent", () => {
    const agent = {
      status: "running",
      pendingPermissions: [{}, {}],
      attentionReason: null,
      turn: { phase: "open", turnId: "t", startedAt: new Date(5_000), cancellationRequestId: null },
      lastActivityAt: new Date(9_000),
      archivedAt: null,
      title: "  Billing worker ",
      lastError: "",
    } as unknown as Agent;
    expect(toDelegationChildSnapshot(agent)).toEqual({
      status: "running",
      pendingPermissionCount: 2,
      attentionReason: null,
      turnStartedAt: 5_000,
      lastActivityAt: 9_000,
      archived: false,
      title: "Billing worker",
      lastError: null,
    });
    expect(toDelegationChildSnapshot(undefined)).toBeNull();
  });
});

describe("delegationTarget", () => {
  it("prefers the managed child, then the newest linked session that is not the owner", () => {
    expect(delegationTarget(ask({ delegatedAgentId: "kid" }), "srv", "me")).toEqual({
      serverId: "srv",
      agentId: "kid",
    });
    const sessions = [
      { serverId: "srv", agentId: "old" },
      { serverId: "laptop", agentId: "new" },
      { serverId: "srv", agentId: "me" },
    ];
    expect(delegationTarget(ask({ sessions }), "srv", "me")).toEqual({
      serverId: "laptop",
      agentId: "new",
    });
    // Without an explicit owner, the ask's origin is the owner.
    expect(
      delegationTarget(
        ask({ sessions, origin: { serverId: "srv", agentId: "me", entryId: "ask:x" } }),
        "srv",
      ),
    ).toEqual({ serverId: "laptop", agentId: "new" });
  });

  it("has none for done asks, linked duplicates, or asks the owner works alone", () => {
    expect(delegationTarget(ask({ state: "done", delegatedAgentId: "kid" }), "srv")).toBeNull();
    expect(
      delegationTarget(
        ask({
          delegatedAgentId: "kid",
          canonicalTask: { serverId: "srv", agentId: "o", entryId: "ask:o" },
        }),
        "srv",
      ),
    ).toBeNull();
    expect(
      delegationTarget(ask({ sessions: [{ serverId: "srv", agentId: "me" }] }), "srv", "me"),
    ).toBeNull();
    expect(delegationTarget(undefined, "srv")).toBeNull();
  });
});

describe("selectDelegatedHere", () => {
  const entry = (id: string, value: Ask): CompanionEntry => ({
    id,
    kind: "question",
    status: "open",
    timestamp: "2026-10-29T09:00:00Z",
    text: `Headline ${id}\nmore`,
    truncated: false,
    ask: value,
  });
  const agent = (id: string, entries: CompanionEntry[], extra: Partial<Agent> = {}) =>
    ({ id, title: `Chat ${id}`, archivedAt: null, companionEntries: entries, ...extra }) as Agent;

  it("finds open asks other chats delegated here, by managed child or linked session", () => {
    const agents = [
      agent("orch", [
        entry("ask:a", ask({ delegatedAgentId: "kid" })),
        entry("ask:done", ask({ state: "done", delegatedAgentId: "kid" })),
        entry("ask:other", ask({ delegatedAgentId: "someone" })),
      ]),
      agent("planner", [
        entry(
          "ask:b",
          ask({
            state: "blocked",
            sessions: [
              { serverId: "srv", agentId: "planner" },
              { serverId: "srv", agentId: "kid" },
            ],
          }),
        ),
      ]),
      agent("archived", [entry("ask:c", ask({ delegatedAgentId: "kid" }))], {
        archivedAt: new Date(),
      }),
      agent("kid", [entry("ask:self", ask({ delegatedAgentId: "kid" }))]),
    ];
    const items = selectDelegatedHere(agents, "srv", "kid", (e) => e.text.split("\n")[0]!);
    expect(items).toEqual([
      {
        ownerAgentId: "orch",
        ownerTitle: "Chat orch",
        entryId: "ask:a",
        headline: "Headline ask:a",
        state: "in_progress",
      },
      {
        ownerAgentId: "planner",
        ownerTitle: "Chat planner",
        entryId: "ask:b",
        headline: "Headline ask:b",
        state: "blocked",
      },
    ]);
  });
});

describe("delegationAttentionKey", () => {
  it("keys only states that need the delegator, per state", () => {
    expect(delegationAttentionKey("ask:a", deriveDelegationPulse(child()))).toBe(
      "child:ask:a:idle",
    );
    expect(
      delegationAttentionKey("ask:a", deriveDelegationPulse(child({ status: "running" }))),
    ).toBeNull();
  });
});
