import { describe, expect, it } from "vitest";
import { buildTabLinkRoute, buildWorkspaceShareUrl } from "./workspace-links";
import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { parseHostWorkspaceOpenIntentFromPathname } from "@/utils/host-routes";

function tab(target: WorkspaceTabTarget): WorkspaceTabDescriptor {
  return { key: "tab", tabId: "tab", kind: target.kind, target };
}

describe("workspace links", () => {
  it("uses stable agent routes and the focused tab's own scope", () => {
    expect(
      buildTabLinkRoute("host", "workspace", {
        ...tab({ kind: "agent", agentId: "session 1" }),
        scope: { serverId: "other/host", workspaceId: "other-workspace" },
      }),
    ).toBe("/h/other%2Fhost/agent/session%201");
  });
  it.each([
    { kind: "terminal", terminalId: "terminal:1" },
    { kind: "file", path: "src/a file #日本.ts" },
    { kind: "setup", workspaceId: "wks_1" },
  ] as const)("round-trips a $kind target", (target) => {
    const route = buildTabLinkRoute("host", "wks_1", tab(target))!;
    expect(parseHostWorkspaceOpenIntentFromPathname(route)).toEqual(target);
  });
  it("does not emit broken links for local drafts and browser tabs", () => {
    expect(buildTabLinkRoute("host", "wks_1", null)).toBeNull();
    expect(buildTabLinkRoute("host", "wks_1", tab({ kind: "draft", draftId: "local" }))).toBeNull();
    expect(
      buildTabLinkRoute("host", "wks_1", tab({ kind: "browser", browserId: "local" })),
    ).toBeNull();
  });
  it("uses the web origin or the fork's OS protocol, never the renderer origin", () => {
    const route = "/h/server/workspace/wks_1?open=terminal%3Aterm1";
    expect(buildWorkspaceShareUrl(route, "https://my-paseo.example")).toBe(
      `https://my-paseo.example${route}`,
    );
    expect(buildWorkspaceShareUrl(route, null)).toBe(`paseo-fork:/${route}`);
    expect(buildWorkspaceShareUrl(route, null, "paseo")).toBe(`paseo:/${route}`);
  });
});
