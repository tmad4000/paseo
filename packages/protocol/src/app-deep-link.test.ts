import { describe, expect, it } from "vitest";
import { buildAppDeepLinkRoute, parseAppDeepLink } from "./app-deep-link.js";

describe("app deep links", () => {
  it.each([
    { serverId: "server/main", agentId: "agent 1" },
    { serverId: "server/main", workspaceId: "wks_1" },
    { serverId: "server/main", workspaceId: "wks_1", open: "terminal:term/1" },
    { serverId: "server/main", workspaceId: "wks_1", open: "file:c3JjL2luZGV4LnRz" },
  ])("round-trips %j", (target) => {
    const route = buildAppDeepLinkRoute(target);
    expect(parseAppDeepLink(`paseo-fork:/${route}`)).toEqual(target);
    expect(parseAppDeepLink(`paseo:/${route}`)).toEqual(target);
  });
  it.each([
    "https://h/server/workspace/wks_1",
    "paseo-fork://app/h/server/workspace/wks_1",
    "paseo-fork://h/server/workspace/wks_1/extra",
    "paseo-fork://h/server/workspace/wks_1?command=run",
    "paseo-fork://h/server/workspace/wks_1?open=terminal:1&open=terminal:2",
    "paseo-fork://h/server/workspace/wks_1?open=unknown:1",
    "paseo-fork://h/server/workspace/wks_1#hash",
    "paseo-fork://user@h/server/workspace/wks_1",
    "paseo-fork://h/%/workspace/wks_1",
    "paseo-fork://h/server/workspace/%20",
  ])("rejects malformed/non-navigation link %s", (link) => {
    expect(parseAppDeepLink(link)).toBeNull();
  });
});
