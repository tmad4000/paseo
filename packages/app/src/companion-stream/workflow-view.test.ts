import { expect, it } from "vitest";
import { parseWorkflowView } from "./workflow-view";
it.each(["tasks", "questions", "saved", "needs_you"] as const)(
  "opens the named %s projection",
  (view) => {
    expect(parseWorkflowView(view)).toBe(view);
  },
);
it.each([undefined, "wrong", ["needs_you"], null])(
  "defaults malformed view %s to Activity",
  (view) => {
    expect(parseWorkflowView(view)).toBe("activity");
  },
);
