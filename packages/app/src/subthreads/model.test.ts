import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import type { PaseoSubagentRow, ProviderSubagentRow } from "@/subagents/select";
import {
  buildSubthreadRows,
  CLOSED_SUBTHREADS_DRAWER,
  condenseActivityText,
  reduceSubthreadsDrawer,
  resolveComposerActivity,
  selectSubthreadActivity,
  resolveSelectedSubthread,
  stepSubthreadSelection,
  summarizeSubthreads,
  type SubthreadsDrawerState,
} from "./model";

function paseoRow(
  overrides: Partial<PaseoSubagentRow> & Pick<PaseoSubagentRow, "id">,
): PaseoSubagentRow {
  return {
    kind: "paseo",
    id: overrides.id,
    provider: "codex",
    title: overrides.title ?? `Agent ${overrides.id}`,
    description: null,
    subtitle: null,
    status: overrides.status ?? "idle",
    turn:
      overrides.status === "running"
        ? { phase: "open", turnId: null, startedAt: null, cancellationRequestId: null }
        : { phase: "idle", cancellationRequestId: null },
    requiresAttention: overrides.requiresAttention ?? false,
    createdAt: overrides.createdAt ?? new Date("2026-10-10T00:00:00.000Z"),
  };
}

function providerRow(
  overrides: Partial<ProviderSubagentRow> & Pick<ProviderSubagentRow, "id">,
): ProviderSubagentRow {
  return {
    kind: "provider",
    id: overrides.id,
    parentAgentId: "parent",
    provider: "claude",
    title: overrides.title ?? "Explore",
    description: overrides.description ?? "Map the auth flow",
    subtitle: null,
    status: overrides.status ?? "running",
    requiresAttention: overrides.status === "failed",
    createdAt: new Date("2026-10-10T00:01:00.000Z"),
  };
}

function agent(overrides: Partial<Agent>): Agent {
  return {
    pendingPermissions: [],
    attentionReason: null,
    workspaceId: "wks_parent",
    ...overrides,
  } as Agent;
}

describe("buildSubthreadRows", () => {
  it("surfaces a pending permission as needs input, which the track pill omits", () => {
    const rows = buildSubthreadRows([paseoRow({ id: "a", requiresAttention: true })], () =>
      agent({ pendingPermissions: [{ id: "p" } as never], attentionReason: "permission" }),
    );
    expect(rows[0]).toMatchObject({ needsInput: true, unread: false, bucket: "needs_input" });
  });

  it("marks a finished, unread managed child as unread and replyable", () => {
    const rows = buildSubthreadRows([paseoRow({ id: "a", requiresAttention: true })], () =>
      agent({ attentionReason: "finished", workspaceId: "wks_child" }),
    );
    expect(rows[0]).toMatchObject({
      bucket: "attention",
      unread: true,
      needsInput: false,
      canReply: true,
      workspaceId: "wks_child",
    });
  });

  it("keeps provider-owned children read-only and names them by task", () => {
    const rows = buildSubthreadRows([providerRow({ id: "t1" })], () => undefined);
    expect(rows[0]).toMatchObject({
      kind: "provider",
      canReply: false,
      label: "Map the auth flow",
      subtitle: "Explore",
      bucket: "running",
    });
  });

  it("summarizes what needs the orchestrator's user", () => {
    const rows = buildSubthreadRows(
      [
        paseoRow({ id: "a", status: "running" }),
        paseoRow({ id: "b", requiresAttention: true }),
        providerRow({ id: "c", status: "failed" }),
      ],
      (id) => (id === "b" ? agent({ attentionReason: "finished" }) : agent({})),
    );
    expect(summarizeSubthreads(rows)).toEqual({
      total: 3,
      needsInput: 0,
      failed: 1,
      unread: 1,
      running: 1,
    });
  });
});

describe("reduceSubthreadsDrawer", () => {
  const selection = { kind: "paseo" as const, id: "child" };

  it("toggles open into the drawer, then hands focus over, then closes", () => {
    const opened = reduceSubthreadsDrawer(CLOSED_SUBTHREADS_DRAWER, { type: "toggle" });
    expect(opened).toMatchObject({ open: true, focus: "drawer" });
    const parentFocused = reduceSubthreadsDrawer(opened, { type: "focus", focus: "parent" });
    expect(reduceSubthreadsDrawer(parentFocused, { type: "toggle" })).toMatchObject({
      open: true,
      focus: "drawer",
    });
    expect(reduceSubthreadsDrawer(opened, { type: "toggle" })).toMatchObject({
      open: false,
      focus: "parent",
    });
  });

  it("returns to the last read subthread when reopened", () => {
    const reading = reduceSubthreadsDrawer(CLOSED_SUBTHREADS_DRAWER, { type: "select", selection });
    const closed = reduceSubthreadsDrawer(reading, { type: "close" });
    expect(reduceSubthreadsDrawer(closed, { type: "open" }).selection).toEqual(selection);
    expect(reduceSubthreadsDrawer(reading, { type: "back" }).selection).toBeNull();
  });

  it("ignores focus changes while closed", () => {
    expect(
      reduceSubthreadsDrawer(CLOSED_SUBTHREADS_DRAWER, { type: "focus", focus: "drawer" }),
    ).toBe(CLOSED_SUBTHREADS_DRAWER);
  });
});

describe("resolveComposerActivity", () => {
  const states: SubthreadsDrawerState[] = [
    CLOSED_SUBTHREADS_DRAWER,
    { open: true, mode: "subagents", focus: "parent", selection: null },
    { open: true, mode: "subagents", focus: "drawer", selection: null },
    { open: true, mode: "subagents", focus: "parent", selection: { kind: "paseo", id: "c" } },
    { open: true, mode: "subagents", focus: "drawer", selection: { kind: "paseo", id: "c" } },
  ];

  it("never activates both composers, in any state or layout", () => {
    for (const state of states) {
      for (const paneInteractive of [true, false]) {
        for (const drawerCoversParent of [true, false]) {
          const result = resolveComposerActivity({ paneInteractive, state, drawerCoversParent });
          expect(result.parentActive && result.subthreadActive).toBe(false);
          if (!paneInteractive)
            expect(result).toEqual({ parentActive: false, subthreadActive: false });
        }
      }
    }
  });

  it("routes input to the subthread only while the drawer owns focus", () => {
    expect(
      resolveComposerActivity({
        paneInteractive: true,
        state: states[4]!,
        drawerCoversParent: false,
      }),
    ).toEqual({ parentActive: false, subthreadActive: true });
    expect(
      resolveComposerActivity({
        paneInteractive: true,
        state: states[3]!,
        drawerCoversParent: false,
      }),
    ).toEqual({ parentActive: true, subthreadActive: false });
  });

  it("keeps the covered parent inert on compact layouts", () => {
    expect(
      resolveComposerActivity({
        paneInteractive: true,
        state: states[3]!,
        drawerCoversParent: true,
      }),
    ).toEqual({ parentActive: false, subthreadActive: true });
    expect(
      resolveComposerActivity({
        paneInteractive: true,
        state: states[1]!,
        drawerCoversParent: true,
      }),
    ).toEqual({ parentActive: false, subthreadActive: false });
  });
});

describe("selection", () => {
  const rows = buildSubthreadRows(
    [paseoRow({ id: "a" }), providerRow({ id: "b" }), paseoRow({ id: "c" })],
    () => agent({}),
  );

  it("drops a selection whose child left the parent", () => {
    expect(resolveSelectedSubthread(rows, { kind: "paseo", id: "gone" })).toBeNull();
    expect(resolveSelectedSubthread(rows, { kind: "provider", id: "a" })).toBeNull();
    expect(resolveSelectedSubthread(rows, { kind: "provider", id: "b" })?.id).toBe("b");
  });

  it("steps through children and wraps", () => {
    expect(stepSubthreadSelection(rows, null, 1)).toEqual({ kind: "paseo", id: "a" });
    expect(stepSubthreadSelection(rows, { kind: "paseo", id: "c" }, 1)).toEqual({
      kind: "paseo",
      id: "a",
    });
    expect(stepSubthreadSelection(rows, { kind: "paseo", id: "a" }, -1)).toEqual({
      kind: "paseo",
      id: "c",
    });
    expect(stepSubthreadSelection([], null, 1)).toBeNull();
  });
});

describe("condensed activity", () => {
  const entry = (overrides: Record<string, unknown>) =>
    ({ id: String(Math.random()), truncated: false, ...overrides }) as never;

  it("shows a pending approval ahead of the latest report", () => {
    expect(
      selectSubthreadActivity([
        entry({
          kind: "outcome",
          status: "completed",
          timestamp: "2026-10-10T10:05:00Z",
          text: "Done",
        }),
        entry({
          kind: "permission",
          status: "pending",
          requestId: "r",
          requestKind: "tool",
          timestamp: "2026-10-10T10:00:00Z",
          text: "Run `npm test`",
        }),
      ]),
    ).toEqual({ kind: "blocker", text: "Run npm test" });
  });

  it("falls back to the newest report and ignores resolved approvals", () => {
    expect(
      selectSubthreadActivity([
        entry({
          kind: "outcome",
          status: "completed",
          timestamp: "2026-10-10T09:00:00Z",
          text: "Old",
        }),
        entry({
          kind: "permission",
          status: "allowed",
          requestId: "r",
          requestKind: "tool",
          timestamp: "2026-10-10T11:00:00Z",
          text: "Allowed",
        }),
        entry({
          kind: "outcome",
          status: "failed",
          timestamp: "2026-10-10T10:00:00Z",
          text: "New",
        }),
      ]),
    ).toEqual({ kind: "report", text: "New" });
    expect(selectSubthreadActivity(undefined)).toBeNull();
  });

  it("condenses markdown into one bounded line and keeps identifiers", () => {
    expect(
      condenseActivityText(
        "---\n\nMerged [PR #61](https://x) in **snake_case_name**.\n\n```ts\ncode\n```",
      ),
    ).toBe("Merged PR #61 in snake_case_name.");
    expect(condenseActivityText("x".repeat(400))).toHaveLength(160);
  });

  it("puts the activity on managed rows only", () => {
    const rows = buildSubthreadRows([paseoRow({ id: "a" }), providerRow({ id: "b" })], () =>
      agent({
        companionEntries: [
          entry({
            kind: "outcome",
            status: "completed",
            timestamp: "2026-10-10T10:00:00Z",
            text: "Shipped",
          }),
        ],
      }),
    );
    expect(rows.map((row) => row.activity)).toEqual([{ kind: "report", text: "Shipped" }, null]);
  });
});
