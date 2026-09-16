import { describe, expect, it } from "vitest";
import { getAssistantTurnFooterLabels } from "./assistant-turn-footer-label";

const now = new Date("2026-09-15T16:40:00");
const startedAt = new Date("2026-09-15T16:26:00");
const completedAt = new Date("2026-09-15T16:32:00");
const durationMs = 6 * 60 * 1000;

describe("getAssistantTurnFooterLabels", () => {
  it("leads with the completion time and duration by default", () => {
    const labels = getAssistantTurnFooterLabels({ startedAt, completedAt, durationMs, now });
    expect(labels.label).toMatch(/^Finished (4:32|16:32)/);
    expect(labels.label).toMatch(/ · 6m$/);
  });

  it("keeps the start time behind the hover swap by default", () => {
    const labels = getAssistantTurnFooterLabels({ startedAt, completedAt, durationMs, now });
    expect(labels.hoverLabel).toMatch(/^Started (4:26|16:26)/);
  });

  it("disables the swap when the start time is unknown", () => {
    const labels = getAssistantTurnFooterLabels({ completedAt, durationMs, now });
    expect(labels.hoverLabel).toBe("");
    expect(labels.label).toMatch(/^Finished (4:32|16:32)/);
  });

  it("degrades to the bare duration when the completion time is unknown", () => {
    const labels = getAssistantTurnFooterLabels({ startedAt, durationMs, now });
    expect(labels.label).toBe("Worked for 6m");
    expect(labels.hoverLabel).toMatch(/^Started (4:26|16:26)/);
  });

  it("shows the completion time alone when the duration is unknown", () => {
    const labels = getAssistantTurnFooterLabels({ completedAt, now });
    expect(labels.label).toMatch(/^Finished (4:32|16:32)/);
    expect(labels.label).not.toContain("·");
  });

  it("returns empty labels when there is nothing to say", () => {
    expect(getAssistantTurnFooterLabels({ now })).toEqual({ label: "", hoverLabel: "" });
  });

  it("anchors on the start time when asked", () => {
    const labels = getAssistantTurnFooterLabels({
      startedAt,
      completedAt,
      durationMs,
      anchor: "started",
      now,
    });
    expect(labels.label).toMatch(/^Started (4:26|16:26)/);
    expect(labels.label).toMatch(/ · 6m$/);
    expect(labels.hoverLabel).toMatch(/^Finished (4:32|16:32)/);
  });

  it("shows both times with no swap when anchored on both", () => {
    const labels = getAssistantTurnFooterLabels({
      startedAt,
      completedAt,
      durationMs,
      anchor: "both",
      now,
    });
    expect(labels.label).toMatch(/^Started (4:26|16:26)/);
    expect(labels.label).toMatch(/Finished (4:32|16:32)/);
    expect(labels.label).toMatch(/ · 6m$/);
    expect(labels.hoverLabel).toBe("");
  });
});
