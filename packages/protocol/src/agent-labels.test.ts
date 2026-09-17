import { describe, expect, test } from "vitest";
import {
  getParentAgentIdFromLabels,
  getOpenAgentTabLabel,
  getReviewNote,
  getReviewStatus,
  hasOpenAgentTab,
  isDelegatedAgent,
  isOpenAgentTabLabel,
  isReviewStatus,
  PARENT_AGENT_ID_LABEL,
  REVIEW_NOTE_LABEL,
  REVIEW_STATUS_LABEL,
} from "./agent-labels.js";

describe("agent label policy", () => {
  test("treats a non-empty parent agent label as delegation", () => {
    const labels = { [PARENT_AGENT_ID_LABEL]: " parent-agent \n" };

    expect(getParentAgentIdFromLabels(labels)).toBe("parent-agent");
    expect(isDelegatedAgent({ labels })).toBe(true);
  });

  test("ignores missing, empty, and non-string parent agent labels", () => {
    expect(isDelegatedAgent({ labels: {} })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } })).toBe(false);
  });

  test("treats any true client-scoped open-tab label as open", () => {
    const desktopLabel = getOpenAgentTabLabel("desktop-client");
    const mobileLabel = getOpenAgentTabLabel("mobile-client");

    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "true" })).toBe(true);
    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "false" })).toBe(false);
    expect(hasOpenAgentTab({})).toBe(false);
  });

  test("recognizes only client-scoped open-tab labels", () => {
    expect(isOpenAgentTabLabel(getOpenAgentTabLabel("client-a"))).toBe(true);
    expect(isOpenAgentTabLabel("paseo.open-agent-tab")).toBe(false);
    expect(isOpenAgentTabLabel("custom.open-agent-tab.client-a")).toBe(false);
  });

  test("reads a valid review status and rejects anything else", () => {
    expect(getReviewStatus({ [REVIEW_STATUS_LABEL]: "ready" })).toBe("ready");
    expect(getReviewStatus({ [REVIEW_STATUS_LABEL]: "approved" })).toBe("approved");
    expect(getReviewStatus({ [REVIEW_STATUS_LABEL]: "done" })).toBeNull();
    expect(getReviewStatus({ [REVIEW_STATUS_LABEL]: 5 })).toBeNull();
    expect(getReviewStatus({})).toBeNull();
    expect(getReviewStatus(null)).toBeNull();
  });

  test("isReviewStatus guards the allowed set", () => {
    expect(isReviewStatus("ready")).toBe(true);
    expect(isReviewStatus("changes_requested")).toBe(true);
    expect(isReviewStatus("clear")).toBe(false);
    expect(isReviewStatus(undefined)).toBe(false);
  });

  test("reads a trimmed review note or null", () => {
    expect(getReviewNote({ [REVIEW_NOTE_LABEL]: "  check the migration  " })).toBe(
      "check the migration",
    );
    expect(getReviewNote({ [REVIEW_NOTE_LABEL]: "   " })).toBeNull();
    expect(getReviewNote({})).toBeNull();
  });
});
