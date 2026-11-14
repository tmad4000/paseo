import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import type { PaseoSubagentRow, ProviderSubagentRow } from "@/subagents/select";
import {
  buildRegistryFocusItems,
  buildSubthreadRows,
  groupSubthreadRows,
  moveRegistryFocus,
  plainReportText,
  registryCardFocusKey,
  registryGroupFocusKey,
  resolveGroupCollapsed,
  resolveRegistryFocusAfterRemoval,
  summarizeRegistryHeader,
  summarizeTaskProgress,
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
    createdAt: overrides.createdAt ?? new Date("2026-10-10T00:01:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-10-10T00:02:00.000Z"),
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

describe("registry cards", () => {
  it("carries model, last activity and the expanded detail without loading the timeline", () => {
    const lastActivityAt = new Date("2026-11-14T09:30:00.000Z");
    const rows = buildSubthreadRows([paseoRow({ id: "a" })], () =>
      agent({
        model: null,
        runtimeInfo: { provider: "claude", sessionId: null, model: "claude-opus-5-5" },
        lastActivityAt,
        currentModeId: "bypassPermissions",
        cwd: "/home/dev/worktrees/registry-phase-1/",
        pendingPermissions: [
          { id: "p1", name: "Bash", title: "Run npm test" } as never,
          { id: "p2", name: "Bash", title: "Run npm run typecheck" } as never,
        ],
        tasks: [
          { text: "Read the spec", completed: true },
          {
            text: "Write tests",
            completed: false,
            status: "in_progress",
            activeForm: "Writing tests",
          },
          { text: "Open the PR", completed: false, status: "pending" },
        ],
        companionEntries: [
          {
            id: "o1",
            kind: "outcome",
            text: "## Done\n\nFiled the issue and **mirrored** it.\n\nWaiting on the tracker.",
            timestamp: "2026-11-14T09:00:00.000Z",
          } as never,
        ],
      }),
    );
    expect(rows[0]).toMatchObject({
      model: "claude-opus-5-5",
      lastActivityAt,
      detail: {
        report: {
          kind: "report",
          text: "Done\n\nFiled the issue and mirrored it.\n\nWaiting on the tracker.",
        },
        pendingPermission: "Run npm run typecheck",
        tasks: { done: 1, total: 3, current: "Writing tests" },
        modeId: "bypassPermissions",
        location: "registry-phase-1",
      },
    });
  });

  it("prefers the agent's chosen model over the runtime's report", () => {
    const rows = buildSubthreadRows([paseoRow({ id: "a" })], () =>
      agent({
        model: "gpt-5.5",
        runtimeInfo: { provider: "codex", sessionId: null, model: "gpt-5.5-mini" },
      }),
    );
    expect(rows[0]?.model).toBe("gpt-5.5");
  });

  it("gives a provider subagent its descriptor's update time, full task and type, no model", () => {
    const updatedAt = new Date("2026-11-14T10:00:00.000Z");
    const rows = buildSubthreadRows(
      [providerRow({ id: "t1", description: "Map the auth flow end to end", updatedAt })],
      () => undefined,
    );
    expect(rows[0]).toMatchObject({
      model: null,
      lastActivityAt: updatedAt,
      detail: { description: "Map the auth flow end to end", subagentType: "Explore", tasks: null },
    });
  });

  it("omits task progress when the agent reports no tasks", () => {
    expect(summarizeTaskProgress(undefined)).toBeNull();
    expect(summarizeTaskProgress([])).toBeNull();
  });

  it("keeps a report's paragraphs but drops its markdown", () => {
    expect(plainReportText("# Title\n\n- [link](http://x)   done\n\n\n\nnext `code`")).toBe(
      "Title\n\n- link done\n\nnext code",
    );
  });
});

describe("registry groups", () => {
  const rows = buildSubthreadRows(
    [
      paseoRow({ id: "spawned-new", createdAt: new Date("2026-10-10T00:05:00.000Z") }),
      providerRow({ id: "task-old", createdAt: new Date("2026-10-10T00:00:00.000Z") }),
      paseoRow({ id: "spawned-old", createdAt: new Date("2026-10-10T00:01:00.000Z") }),
      providerRow({ id: "task-failed", status: "failed" }),
    ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
    () => agent({}),
  );

  it("never interleaves the kinds and keeps creation order inside each", () => {
    const groups = groupSubthreadRows(rows);
    expect(groups.map((group) => group.kind)).toEqual(["paseo", "provider"]);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(["spawned-old", "spawned-new"]);
    expect(groups[1]?.rows.map((row) => row.id)).toEqual(["task-old", "task-failed"]);
    expect(groups[1]?.summary).toMatchObject({ total: 2, failed: 1 });
  });

  it("drops an empty group", () => {
    const groups = groupSubthreadRows(rows.filter((row) => row.kind === "provider"));
    expect(groups.map((group) => group.kind)).toEqual(["provider"]);
  });

  it("counts spawned agents only in the header, so a failed Explore task does not need you", () => {
    expect(summarizeRegistryHeader(rows)).toEqual({
      total: 2,
      needsInput: 0,
      failed: 0,
      unread: 0,
      running: 0,
    });
    const providerOnly = rows.filter((row) => row.kind === "provider");
    expect(summarizeRegistryHeader(providerOnly)).toMatchObject({ total: 2, failed: 0 });
  });

  it("folds provider subagents by default only when the chat has spawned agents", () => {
    expect(resolveGroupCollapsed({ kind: "paseo", stored: undefined, hasSpawned: true })).toBe(
      false,
    );
    expect(resolveGroupCollapsed({ kind: "provider", stored: undefined, hasSpawned: true })).toBe(
      true,
    );
    expect(resolveGroupCollapsed({ kind: "provider", stored: undefined, hasSpawned: false })).toBe(
      false,
    );
    expect(resolveGroupCollapsed({ kind: "provider", stored: false, hasSpawned: true })).toBe(
      false,
    );
    expect(resolveGroupCollapsed({ kind: "paseo", stored: true, hasSpawned: true })).toBe(true);
  });
});

describe("registry roving focus", () => {
  const rows = buildSubthreadRows(
    [paseoRow({ id: "a" }), paseoRow({ id: "b" }), providerRow({ id: "t" })],
    () => agent({}),
  );
  const groups = groupSubthreadRows(rows);
  const expanded = buildRegistryFocusItems(groups, () => false);

  it("walks headings and cards across groups, and skips a folded group's cards", () => {
    expect(expanded.map((item) => item.key)).toEqual([
      "group:paseo",
      "card:paseo:a",
      "card:paseo:b",
      "group:provider",
      "card:provider:t",
    ]);
    const folded = buildRegistryFocusItems(groups, (kind) => kind === "paseo");
    expect(folded.map((item) => item.key)).toEqual([
      "group:paseo",
      "group:provider",
      "card:provider:t",
    ]);
  });

  it("stops at the ends instead of wrapping", () => {
    expect(moveRegistryFocus(expanded, null, 1)).toBe("group:paseo");
    expect(moveRegistryFocus(expanded, "card:paseo:b", 1)).toBe("group:provider");
    expect(moveRegistryFocus(expanded, "card:provider:t", 1)).toBe("card:provider:t");
    expect(moveRegistryFocus(expanded, "group:paseo", -1)).toBe("group:paseo");
    expect(moveRegistryFocus([], null, 1)).toBeNull();
  });

  it("never loses focus when the focused card leaves", () => {
    const withoutA = expanded.filter(
      (item) => item.key !== registryCardFocusKey({ kind: "paseo", id: "a" }),
    );
    expect(resolveRegistryFocusAfterRemoval(expanded, withoutA, "card:paseo:a")).toBe(
      "card:paseo:b",
    );
    const last = expanded.filter((item) => item.key !== "card:provider:t");
    expect(resolveRegistryFocusAfterRemoval(expanded, last, "card:provider:t")).toBe(
      registryGroupFocusKey("provider"),
    );
  });
});
