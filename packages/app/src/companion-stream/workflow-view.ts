/** UI view names map directly to the daemon's canonical Stream projections. */
export type WorkflowView = "activity" | "tasks" | "questions" | "saved" | "needs_you";
export function parseWorkflowView(value: unknown): WorkflowView {
  switch (value) {
    case "tasks":
    case "questions":
    case "saved":
    case "needs_you":
      return value;
    default:
      return "activity";
  }
}
