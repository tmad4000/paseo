import { describe, expect, it } from "vitest";
import { resolveCloseAgentTabPolicy } from "./close-tab-policy";
import { threadLabels } from "@/threads/model";

describe("resolveCloseAgentTabPolicy", () => {
  it("archives root agents when their tab closes", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: null })).toEqual({
      kind: "archive-on-close",
    });
  });

  it("keeps subagent tab close layout-only", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: "parent-agent" })).toEqual({
      kind: "layout-only",
    });
  });

  it("keeps a thread when its tab closes: the reply's chip reopens it", () => {
    expect(
      resolveCloseAgentTabPolicy({
        parentAgentId: null,
        workspaceId: "home",
        labels: threadLabels({ parentAgentId: "parent", anchor: "msg-1" }),
      }),
    ).toEqual({ kind: "layout-only" });
  });

  it("preserves the existing archive fallback when the agent is missing", () => {
    expect(resolveCloseAgentTabPolicy(null)).toEqual({ kind: "archive-on-close" });
    expect(resolveCloseAgentTabPolicy(undefined)).toEqual({ kind: "archive-on-close" });
  });

  it("closes a session shown in another workspace's split without archiving it", () => {
    expect(
      resolveCloseAgentTabPolicy({ parentAgentId: null, workspaceId: "home" }, "elsewhere"),
    ).toEqual({ kind: "layout-only" });
    expect(
      resolveCloseAgentTabPolicy({ parentAgentId: null, workspaceId: "home" }, "home"),
    ).toEqual({ kind: "archive-on-close" });
    expect(
      resolveCloseAgentTabPolicy({ parentAgentId: null, workspaceId: undefined }, "home"),
    ).toEqual({ kind: "archive-on-close" });
  });
});
