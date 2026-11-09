import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { TabReadState } from "@/screens/workspace/workspace-tab-activity";

/**
 * Which marks a tab's icon carries, and where. Two independent questions are answered at once:
 *
 * - What the agent is doing: the running ring and the needs-input alert. An agent can be both —
 *   working while flagged (by a permission or by hand) as needing you — so they are separate
 *   flags, not one bucket. The ring owns the bottom-right corner; an alert that has to share
 *   the icon with it moves to the top-left.
 * - Where the reader is: two overlapping circles. The hollow ring is the official read layer
 *   (unread until marked read, settable by hand). The filled dot in front of it is the seen
 *   layer: activity this device has not looked at yet. `new` draws both, `seen` only the ring,
 *   `read` nothing. They sit in the bottom-right corner when it is free, top-right otherwise,
 *   so they stay visible while the agent is running or needs input.
 */
export type TabMarkPlacement = "bottomRight" | "topRight" | "topLeft";

export interface TabStatusMarks {
  running: boolean;
  needsInput: TabMarkPlacement | null;
  /** A plain status dot, for icons that do not track read state (failed / attention). */
  statusDot: "failed" | "attention" | null;
  read: {
    placement: TabMarkPlacement;
    /** The filled seen-layer dot: activity this device has not looked at yet. */
    unseen: boolean;
    /** Failed agents draw their read layers red instead of accent. */
    tone: "failed" | "accent";
  } | null;
}

export function resolveTabStatusMarks(input: {
  bucket: SidebarStateBucket | null;
  /** Working right now, independent of the bucket (which ranks needs_input above running). */
  running: boolean;
  readState: TabReadState | undefined;
}): TabStatusMarks {
  const { bucket, readState } = input;
  const running = input.running || bucket === "running";
  const needsInputFlag = bucket === "needs_input";
  let needsInput: TabMarkPlacement | null = null;
  if (needsInputFlag) needsInput = running ? "topLeft" : "bottomRight";
  const cornerTaken = running || needsInputFlag;

  let read: TabStatusMarks["read"] = null;
  if (readState === "new" || readState === "seen") {
    read = {
      placement: cornerTaken ? "topRight" : "bottomRight",
      unseen: readState === "new",
      tone: bucket === "failed" ? "failed" : "accent",
    };
  }

  let statusDot: TabStatusMarks["statusDot"] = null;
  // Icons that track read state let the read layers speak for a finished or failed agent.
  if (readState === undefined && !cornerTaken && (bucket === "failed" || bucket === "attention")) {
    statusDot = bucket;
  }

  return { running, needsInput, statusDot, read };
}
