import { describe, expect, it, vi } from "vitest";
import {
  createNavigationFocusHistory,
  type NavigationFocusLocation,
  type WorkspaceFocusLocation,
} from "./focus-history";

function workspace(
  workspaceId: string,
  tabId: string,
  panel: WorkspaceFocusLocation["view"]["panel"] = "agent",
): WorkspaceFocusLocation {
  return {
    kind: "workspace",
    serverId: "server-1",
    workspaceId,
    paneId: "pane-1",
    tabId,
    target: { kind: "agent", agentId: tabId },
    view: { panel, explorerTab: "changes" },
  };
}

describe("navigation focus history", () => {
  it("returns to tab focus in true recency order, including across workspaces", () => {
    const history = createNavigationFocusHistory();
    const firstAgent = workspace("workspace-a", "agent-a");
    const secondAgent = workspace("workspace-a", "agent-b");
    const otherWorkspace = workspace("workspace-b", "agent-c");

    history.record(firstAgent);
    history.record(secondAgent);
    history.record(otherWorkspace);

    expect(history.back()).toEqual(secondAgent);
    history.record(secondAgent);
    expect(history.back()).toEqual(firstAgent);
  });

  it("treats compact panel changes as focus locations", () => {
    const history = createNavigationFocusHistory();
    const content = workspace("workspace-a", "agent-a");
    const explorer = workspace("workspace-a", "agent-a", "file-explorer");

    history.record(content);
    history.record(explorer);

    expect(history.back()).toEqual(content);
  });

  it("deduplicates repeated observations of the same location", () => {
    const history = createNavigationFocusHistory();
    const listener = vi.fn();
    const location = workspace("workspace-a", "agent-a");
    history.subscribe(listener);

    history.record(location);
    history.record({ ...location });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(history.getSnapshot().canGoBack).toBe(false);
  });

  it("ignores intermediate observations while crossing workspace routes", () => {
    const history = createNavigationFocusHistory();
    const first = workspace("workspace-a", "agent-a");
    const second = workspace("workspace-b", "agent-b");
    const staleIntermediate = workspace("workspace-b", "agent-a", "file-explorer");

    history.record(first);
    history.record(second);
    expect(history.back()).toEqual(first);
    history.record(staleIntermediate);

    expect(history.getSnapshot().restoring).toBe(true);
    history.record(first);
    expect(history.getSnapshot()).toMatchObject({ current: first, restoring: false });
  });

  it("records app routes in the same recency stack", () => {
    const history = createNavigationFocusHistory();
    const workspaceLocation = workspace("workspace-a", "agent-a");
    const settings: NavigationFocusLocation = { kind: "route", pathname: "/settings/general" };

    history.record(workspaceLocation);
    history.record(settings);

    expect(history.back()).toEqual(workspaceLocation);
  });

  it("moves forward again after going back, like a browser", () => {
    const history = createNavigationFocusHistory();
    const first = workspace("workspace-a", "agent-a");
    const second = workspace("workspace-b", "agent-b");
    const third = workspace("workspace-c", "agent-c");
    history.record(first);
    history.record(second);
    history.record(third);

    expect(history.back()).toEqual(second);
    history.record(second);
    expect(history.back()).toEqual(first);
    history.record(first);
    expect(history.getSnapshot()).toMatchObject({ canGoBack: false, canGoForward: true });

    expect(history.forward()).toEqual(second);
    history.record(second);
    expect(history.forward()).toEqual(third);
    history.record(third);
    expect(history.getSnapshot()).toMatchObject({
      current: third,
      canGoBack: true,
      canGoForward: false,
    });
  });

  it("drops the forward branch when focusing somewhere new", () => {
    const history = createNavigationFocusHistory();
    const first = workspace("workspace-a", "agent-a");
    const second = workspace("workspace-b", "agent-b");
    const elsewhere = workspace("workspace-d", "agent-d");
    history.record(first);
    history.record(second);
    history.back();
    history.record(first);

    history.record(elsewhere);

    expect(history.getSnapshot().canGoForward).toBe(false);
    expect(history.back()).toEqual(first);
  });

  it("disables both directions while a restore is in flight", () => {
    const history = createNavigationFocusHistory();
    history.record(workspace("workspace-a", "agent-a"));
    history.record(workspace("workspace-b", "agent-b"));
    history.record(workspace("workspace-c", "agent-c"));
    history.back();

    expect(history.getSnapshot()).toMatchObject({
      canGoBack: false,
      canGoForward: false,
      restoring: true,
    });
    expect(history.back()).toBeNull();
    expect(history.forward()).toBeNull();
  });

  it("skips a target whose restore failed instead of failing on it again", () => {
    const history = createNavigationFocusHistory();
    const first = workspace("workspace-a", "agent-a");
    const deleted = workspace("workspace-gone", "agent-x");
    const current = workspace("workspace-c", "agent-c");
    history.record(first);
    history.record(deleted);
    history.record(current);

    expect(history.back()).toEqual(deleted);
    history.cancelRestore();

    expect(history.getSnapshot()).toMatchObject({ current, canGoForward: false, restoring: false });
    expect(history.back()).toEqual(first);
  });

  it("settles a restore that changed nothing on screen, keeping what is focused", () => {
    const history = createNavigationFocusHistory();
    const closedTab = workspace("workspace-a", "agent-closed");
    const current = workspace("workspace-a", "agent-b");
    history.record(closedTab);
    history.record(current);

    expect(history.back()).toEqual(closedTab);
    history.settleRestore(current);

    expect(history.getSnapshot()).toMatchObject({ current, restoring: false, canGoForward: true });
    history.record(workspace("workspace-z", "agent-z"));
    expect(history.back()).toEqual(current);
  });

  it("treats a cross-route restore that never arrived as failed", () => {
    const history = createNavigationFocusHistory();
    const first = workspace("workspace-a", "agent-a");
    const unreachable = workspace("workspace-b", "agent-b");
    const current = workspace("workspace-c", "agent-c");
    history.record(first);
    history.record(unreachable);
    history.record(current);

    history.back();
    history.settleRestore(current);

    expect(history.getSnapshot()).toMatchObject({ current, restoring: false });
    expect(history.back()).toEqual(first);
  });

  it("jumps several steps from the history menu and walks forward through the skipped ones", () => {
    const history = createNavigationFocusHistory();
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => workspace(`workspace-${id}`, id));
    for (const location of [a, b, c, d]) history.record(location);

    expect(history.getSnapshot().backEntries).toEqual([c, b, a]);
    expect(history.back(2)).toEqual(b);
    history.record(b);

    expect(history.getSnapshot()).toMatchObject({ backEntries: [a], forwardEntries: [c, d] });
    expect(history.forward()).toEqual(c);
    history.record(c);
    expect(history.forward()).toEqual(d);
  });

  it("refuses a jump longer than the history", () => {
    const history = createNavigationFocusHistory();
    history.record(workspace("workspace-a", "a"));
    history.record(workspace("workspace-b", "b"));

    expect(history.back(2)).toBeNull();
    expect(history.back(0)).toBeNull();
    expect(history.getSnapshot()).toMatchObject({ restoring: false, canGoBack: true });
  });

  it("drops only the unreachable entry when a multi-step jump fails", () => {
    const history = createNavigationFocusHistory();
    const [a, gone, c, d] = ["a", "gone", "c", "d"].map((id) => workspace(`workspace-${id}`, id));
    for (const location of [a, gone, c, d]) history.record(location);

    expect(history.back(2)).toEqual(gone);
    history.cancelRestore();

    expect(history.getSnapshot()).toMatchObject({ current: d, backEntries: [c, a] });
  });
});
