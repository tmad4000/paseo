import { describe, expect, it } from "vitest";
import {
  askBlockerReason,
  needsUserInput,
  needsYouGroup,
  type CompanionEntry,
} from "./companion-stream.js";

const ask = (
  state: "open" | "in_progress" | "blocked" | "done",
  extra: Partial<CompanionEntry> = {},
  askExtra: Record<string, unknown> = {},
): CompanionEntry =>
  ({
    id: "ask:deploy",
    kind: "question",
    status: state === "done" ? "done" : "open",
    timestamp: "2026-11-03T00:00:00.000Z",
    text: "Deploy the release",
    truncated: false,
    ask: {
      state,
      remaining: "Needs your go-ahead to deploy to production\nThen verify.",
      evidence: "",
      revision: 1,
      provenance: "explicit",
      ...askExtra,
    },
    ...extra,
  }) as CompanionEntry;

describe("needsUserInput for tracked asks", () => {
  it("counts a blocked ask as waiting on the user by default", () => {
    expect(needsUserInput(ask("blocked"))).toBe(true);
  });

  it("ignores asks that are not blocked", () => {
    expect(["open", "in_progress", "done"].map((s) => needsUserInput(ask(s as "open")))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("never counts a mirror; the canonical origin does", () => {
    const mirror = ask(
      "blocked",
      {},
      {
        canonicalTask: { serverId: "h", agentId: "a", entryId: "ask:deploy" },
      },
    );
    expect(needsUserInput(mirror)).toBe(false);
  });

  it("keeps an ask blocked on an agent or external party out", () => {
    for (const recipient of ["agent", "external"] as const) {
      const entry = ask("blocked", {
        inputRequest: { kind: "action", recipient, recipientId: "YouTube Studio" },
      });
      expect(needsUserInput(entry)).toBe(false);
    }
    expect(
      needsUserInput(ask("blocked", { inputRequest: { kind: "approval", recipient: "user" } })),
    ).toBe(true);
  });

  it("leaves explicit questions and permissions unchanged", () => {
    const question: CompanionEntry = {
      id: "question:db",
      kind: "question",
      status: "open",
      timestamp: "t",
      text: "Which DB?",
      truncated: false,
    };
    expect(needsUserInput(question)).toBe(true);
    expect(needsUserInput({ ...question, status: "done" })).toBe(false);
    const permission: CompanionEntry = {
      id: "permission:p",
      kind: "permission",
      requestId: "p",
      requestKind: "tool",
      status: "pending",
      timestamp: "t",
      text: "Allow git push",
      truncated: false,
    };
    expect(needsUserInput(permission)).toBe(true);
    expect(needsYouGroup(permission)).toBe("permission");
    expect(needsYouGroup(question)).toBe("question");
    expect(needsYouGroup(ask("blocked"))).toBe("blocked");
  });
});

describe("askBlockerReason", () => {
  it("returns the first non-empty trimmed line", () => {
    expect(askBlockerReason("\n  Needs your go-ahead.  \nThen verify.")).toBe(
      "Needs your go-ahead.",
    );
    expect(askBlockerReason("")).toBe("");
  });
});
