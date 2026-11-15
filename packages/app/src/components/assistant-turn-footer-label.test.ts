import { i18n } from "@/i18n/i18next";
import { describe, expect, it } from "vitest";
import { formatMessageTimestamp } from "@/utils/time";
import {
  getAssistantTurnFooterLabels as getLabels,
  getTurnDurationLabel,
} from "./assistant-turn-footer-label";

const getAssistantTurnFooterLabels = (input: Parameters<typeof getLabels>[0]) =>
  getLabels(input, i18n.t);

describe("assistant turn footer labels", () => {
  const now = new Date(2026, 9, 6, 17);
  const completedAt = new Date(2026, 9, 6, 16, 32);
  const startedAt = new Date(2026, 9, 6, 16, 26);

  it("keeps completion and duration visible and reveals the real start separately", () => {
    expect(
      getAssistantTurnFooterLabels({ startedAt, completedAt, durationMs: 360_000, now }),
    ).toEqual({
      label: `Finished ${formatMessageTimestamp(completedAt, now)} · 6m`,
      hoverLabel: `Started ${formatMessageTimestamp(startedAt, now)}`,
    });
  });

  it("shows completion without inventing an unknown duration or start", () => {
    expect(getAssistantTurnFooterLabels({ completedAt, durationMs: null, now })).toEqual({
      label: `Finished ${formatMessageTimestamp(completedAt, now)}`,
      hoverLabel: "",
    });
  });

  it("retains duration-only wording when completion is missing or invalid", () => {
    for (const completion of [undefined, new Date(NaN)]) {
      expect(
        getAssistantTurnFooterLabels({ completedAt: completion, durationMs: 7000, now }),
      ).toEqual({
        label: "Worked for 7s",
        hoverLabel: "",
      });
    }
  });

  it("does not render invalid times or invalid durations", () => {
    for (const durationMs of [undefined, null, -1, NaN, Infinity]) {
      expect(
        getAssistantTurnFooterLabels({
          completedAt: new Date(NaN),
          startedAt: new Date(NaN),
          durationMs,
          now,
        }),
      ).toEqual({ label: "", hoverLabel: "" });
    }
  });

  it("retains a known zero duration", () => {
    expect(getAssistantTurnFooterLabels({ completedAt, durationMs: 0, now }).label).toBe(
      `Finished ${formatMessageTimestamp(completedAt, now)} · 0s`,
    );
  });
});

describe("localized full turn timestamps", () => {
  it("keeps completion, duration and start in the active language", async () => {
    await i18n.changeLanguage("fr");
    try {
      const now = new Date(2026, 9, 6, 17);
      const startedAt = new Date(2026, 9, 6, 16, 26);
      const completedAt = new Date(2026, 9, 6, 16, 32);
      expect(getLabels({ now, startedAt, completedAt, durationMs: 360_000 }, i18n.t)).toEqual({
        label: `Terminé ${formatMessageTimestamp(completedAt, now)} · 6m`,
        hoverLabel: `Commencé ${formatMessageTimestamp(startedAt, now)}`,
      });
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("getTurnDurationLabel", () => {
  it("says how long the turn worked", () => {
    expect(getTurnDurationLabel(14_000, i18n.t)).toBe("Worked for 14s");
  });

  it("reads in the active app language", async () => {
    await i18n.changeLanguage("fr");
    try {
      expect(getTurnDurationLabel(14_000, i18n.t)).toBe("A travaillé pendant 14s");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
