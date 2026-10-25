import { describe, expect, it } from "vitest";
import { CLOSED_SUBTHREADS_DRAWER, reduceSubthreadsDrawer } from "./model";
import {
  CHECKLIST_URL_LABEL,
  parseChecklistUrl,
  parseSidePanelLabel,
  SIDE_PANEL_LABEL,
  sidePanelLabelPatch,
} from "./side-panel-labels";
import { clampSidePanelWidth, SIDE_PANEL_MIN_WIDTH } from "./side-panel-width-store";

describe("side panel labels", () => {
  it("distinguishes no stored choice from closed", () => {
    expect(parseSidePanelLabel(undefined)).toBeUndefined();
    expect(parseSidePanelLabel("")).toBeNull();
    expect(parseSidePanelLabel("nonsense")).toBeNull();
    expect(parseSidePanelLabel(" Checklist ")).toBe("checklist");
    expect(parseSidePanelLabel("subagents")).toBe("subagents");
  });

  it("embeds only absolute http(s) checklist URLs", () => {
    expect(parseChecklistUrl("https://m4-mini.tailb2a35c.ts.net:4387/session/abc")).toBe(
      "https://m4-mini.tailb2a35c.ts.net:4387/session/abc",
    );
    expect(parseChecklistUrl("javascript:alert(1)")).toBeNull();
    expect(parseChecklistUrl("file:///etc/passwd")).toBeNull();
    expect(parseChecklistUrl("not a url")).toBeNull();
    expect(parseChecklistUrl(undefined)).toBeNull();
  });

  it("writes the same labels the CLI documents", () => {
    expect(sidePanelLabelPatch("checklist")).toEqual({ [SIDE_PANEL_LABEL]: "checklist" });
    expect(sidePanelLabelPatch(null)).toEqual({ [SIDE_PANEL_LABEL]: "" });
    expect(SIDE_PANEL_LABEL).toBe("paseo.side-panel");
    expect(CHECKLIST_URL_LABEL).toBe("paseo.checklist-url");
  });
});

describe("label-driven panel state", () => {
  it("opens the requested mode without taking the user's input", () => {
    const next = reduceSubthreadsDrawer(CLOSED_SUBTHREADS_DRAWER, {
      type: "apply-label",
      panel: "checklist",
    });
    expect(next).toMatchObject({ open: true, mode: "checklist", focus: "parent" });
  });

  it("switches mode in place, keeps focus, and closes on null", () => {
    const reading = reduceSubthreadsDrawer(CLOSED_SUBTHREADS_DRAWER, {
      type: "select",
      selection: { kind: "paseo", id: "c" },
    });
    const switched = reduceSubthreadsDrawer(reading, { type: "apply-label", panel: "checklist" });
    expect(switched).toMatchObject({ open: true, mode: "checklist", focus: "drawer" });
    expect(switched.selection).toEqual({ kind: "paseo", id: "c" });
    expect(reduceSubthreadsDrawer(switched, { type: "apply-label", panel: "checklist" })).toBe(
      switched,
    );
    expect(reduceSubthreadsDrawer(switched, { type: "apply-label", panel: null })).toMatchObject({
      open: false,
      focus: "parent",
    });
  });

  it("drops a stale selection without moving input", () => {
    const state = {
      open: true,
      mode: "subagents" as const,
      focus: "parent" as const,
      selection: { kind: "paseo" as const, id: "c" },
    };
    expect(reduceSubthreadsDrawer(state, { type: "clear-selection" })).toEqual({
      ...state,
      selection: null,
    });
  });
});

describe("side panel width", () => {
  it("keeps room for the parent chat and respects the floor", () => {
    expect(clampSidePanelWidth(900, 1400)).toBe(720);
    expect(clampSidePanelWidth(600, 900)).toBe(500);
    expect(clampSidePanelWidth(100, 1400)).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(clampSidePanelWidth(500, 500)).toBe(SIDE_PANEL_MIN_WIDTH);
  });
});
