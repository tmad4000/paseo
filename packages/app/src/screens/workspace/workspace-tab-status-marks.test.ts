import { describe, expect, it } from "vitest";
import { resolveTabStatusMarks } from "./workspace-tab-status-marks";

describe("resolveTabStatusMarks", () => {
  it("shows the running ring and the needs-input alert together", () => {
    // A manual "Needs input" mark (or a pending permission) on a working agent: the bucket says
    // needs_input, the running flag says it is still working.
    const marks = resolveTabStatusMarks({
      bucket: "needs_input",
      running: true,
      readState: "read",
    });
    expect(marks.running).toBe(true);
    expect(marks.needsInput).toBe("topLeft");
    expect(marks.read).toBeNull();
  });

  it("keeps the alert in the corner when the agent is not working", () => {
    const marks = resolveTabStatusMarks({
      bucket: "needs_input",
      running: false,
      readState: "read",
    });
    expect(marks.running).toBe(false);
    expect(marks.needsInput).toBe("bottomRight");
  });

  it("treats a running bucket as running even without the flag", () => {
    const marks = resolveTabStatusMarks({
      bucket: "running",
      running: false,
      readState: undefined,
    });
    expect(marks.running).toBe(true);
    expect(marks.needsInput).toBeNull();
  });

  it("keeps both read layers visible while running: unread and not seen", () => {
    const marks = resolveTabStatusMarks({ bucket: "running", running: true, readState: "new" });
    expect(marks.running).toBe(true);
    expect(marks.read).toEqual({ placement: "topRight", unseen: true, tone: "accent" });
  });

  it("running + unread + seen draws only the read ring, beside the running ring", () => {
    const marks = resolveTabStatusMarks({ bucket: "running", running: true, readState: "seen" });
    expect(marks.read).toEqual({ placement: "topRight", unseen: false, tone: "accent" });
  });

  it("running + needs input + unread shows all three marks without sharing a corner", () => {
    const marks = resolveTabStatusMarks({ bucket: "needs_input", running: true, readState: "new" });
    expect(marks.running).toBe(true);
    expect(marks.needsInput).toBe("topLeft");
    expect(marks.read?.placement).toBe("topRight");
    const placements = [marks.needsInput, marks.read?.placement, "bottomRight"];
    expect(new Set(placements).size).toBe(3);
  });

  it("needs input (idle) + unread moves the read layers off the alert's corner", () => {
    const marks = resolveTabStatusMarks({
      bucket: "needs_input",
      running: false,
      readState: "seen",
    });
    expect(marks.needsInput).toBe("bottomRight");
    expect(marks.read?.placement).toBe("topRight");
  });

  it("an idle unread tab keeps its read layers in the corner", () => {
    expect(
      resolveTabStatusMarks({ bucket: "attention", running: false, readState: "new" }),
    ).toEqual({
      running: false,
      needsInput: null,
      statusDot: null,
      read: { placement: "bottomRight", unseen: true, tone: "accent" },
    });
  });

  it("manually unread but already seen: ring without the seen dot", () => {
    const marks = resolveTabStatusMarks({ bucket: "done", running: false, readState: "seen" });
    expect(marks.read).toEqual({ placement: "bottomRight", unseen: false, tone: "accent" });
  });

  it("draws a failed agent's read layers red", () => {
    const marks = resolveTabStatusMarks({ bucket: "failed", running: false, readState: "new" });
    expect(marks.read?.tone).toBe("failed");
    expect(marks.statusDot).toBeNull();
  });

  it("shows nothing for a read, idle tab", () => {
    expect(resolveTabStatusMarks({ bucket: "done", running: false, readState: "read" })).toEqual({
      running: false,
      needsInput: null,
      statusDot: null,
      read: null,
    });
  });

  it("falls back to the bucket dot on icons that do not track read state", () => {
    expect(
      resolveTabStatusMarks({ bucket: "failed", running: false, readState: undefined }).statusDot,
    ).toBe("failed");
    expect(
      resolveTabStatusMarks({ bucket: "attention", running: false, readState: undefined })
        .statusDot,
    ).toBe("attention");
    expect(
      resolveTabStatusMarks({ bucket: "failed", running: false, readState: "read" }).statusDot,
    ).toBeNull();
  });
});
