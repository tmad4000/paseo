import { MANUAL_NEEDS_INPUT_LABEL, REVIEW_STATUS_LABEL } from "./agent-labels.js";
import { describe, expect, it } from "vitest";
import {
  deriveAgentStateBucket,
  getAgentStatusPriority,
  getWorkspaceStateBucketPriority,
} from "./agent-state-bucket.js";

describe("deriveAgentStateBucket", () => {
  it("prioritizes pending permissions as needs_input", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        pendingPermissionCount: 1,
        requiresAttention: false,
        attentionReason: null,
      }),
    ).toBe("needs_input");
  });

  it("keeps legacy permission attention in needs_input", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "permission",
      }),
    ).toBe("needs_input");
  });

  it("prioritizes error attention before running status", () => {
    expect(
      deriveAgentStateBucket({
        status: "running",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "error",
      }),
    ).toBe("failed");
  });

  it("treats unread finished agents as attention", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ).toBe("attention");
  });

  it("does not count initializing agents as running for workspace buckets", () => {
    expect(
      deriveAgentStateBucket({
        status: "initializing",
        pendingPermissionCount: 0,
        requiresAttention: false,
        attentionReason: null,
      }),
    ).toBe("done");
  });
});

describe("getWorkspaceStateBucketPriority", () => {
  it("orders active buckets before done", () => {
    expect(
      ["done", "attention", "running", "failed", "needs_input"].sort(
        (left, right) =>
          getWorkspaceStateBucketPriority(left) - getWorkspaceStateBucketPriority(right),
      ),
    ).toEqual(["needs_input", "failed", "running", "attention", "done"]);
  });
});

describe("getAgentStatusPriority", () => {
  it("keeps initializing agents ahead of completed agents in agent lists", () => {
    expect(getAgentStatusPriority({ status: "initializing" })).toBeLessThan(
      getAgentStatusPriority({ status: "idle" }),
    );
  });

  it("prioritizes pending permissions before errors and running agents", () => {
    const permission = getAgentStatusPriority({ status: "running", pendingPermissionCount: 1 });
    expect(permission).toBeLessThan(
      getAgentStatusPriority({ status: "error", pendingPermissionCount: 0 }),
    );
    expect(permission).toBeLessThan(
      getAgentStatusPriority({ status: "running", pendingPermissionCount: 0 }),
    );
  });
});

describe("manual status markers", () => {
  it("needs input survives read attention clearing without creating a permission", () => {
    const labels = { [MANUAL_NEEDS_INPUT_LABEL]: "true" };
    expect(
      deriveAgentStateBucket({
        status: "idle",
        labels,
        requiresAttention: false,
        pendingPermissionCount: 0,
      }),
    ).toBe("needs_input");
    expect(deriveAgentStateBucket({ status: "running", labels })).toBe("needs_input");
    expect(getAgentStatusPriority({ status: "idle", labels })).toBe(0);
  });
  it("clearing a manual marker cannot clear actual permission or error attention", () => {
    expect(deriveAgentStateBucket({ status: "idle", labels: {}, pendingPermissionCount: 1 })).toBe(
      "needs_input",
    );
    expect(
      deriveAgentStateBucket({ status: "idle", labels: {}, attentionReason: "permission" }),
    ).toBe("needs_input");
    expect(
      deriveAgentStateBucket({ status: "error", labels: { [REVIEW_STATUS_LABEL]: "approved" } }),
    ).toBe("failed");
  });
  it.each(["ready", "in_review", "changes_requested"])(
    "keeps %s visible after reading, without hiding running or real permissions",
    (status) => {
      const labels = { [REVIEW_STATUS_LABEL]: status };
      expect(deriveAgentStateBucket({ status: "idle", labels, requiresAttention: false })).toBe(
        "attention",
      );
      expect(deriveAgentStateBucket({ status: "running", labels })).toBe("running");
      expect(deriveAgentStateBucket({ status: "idle", labels, pendingPermissionCount: 1 })).toBe(
        "needs_input",
      );
    },
  );
  it("approval does not erase unread activity", () => {
    const labels = { [REVIEW_STATUS_LABEL]: "approved" };
    expect(deriveAgentStateBucket({ status: "idle", labels })).toBe("done");
    expect(deriveAgentStateBucket({ status: "idle", labels, requiresAttention: true })).toBe(
      "attention",
    );
  });
});
