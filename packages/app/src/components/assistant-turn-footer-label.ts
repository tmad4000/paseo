import { formatDuration, formatMessageTimestamp } from "@/utils/time";

/**
 * Which moment anchors the always-visible label at the end of an assistant
 * turn. The reader at the bottom of a long response is asking "when did this
 * finish"; the turn's start time is already visible on the user message that
 * opened it, so the footer defaults to the completion time and keeps the
 * start time behind hover/tap. Changing this constant is the whole change if
 * that call is ever revisited.
 */
export type AssistantTurnTimeAnchor = "completed" | "started" | "both";

export const ASSISTANT_TURN_TIME_ANCHOR: AssistantTurnTimeAnchor = "completed";

export interface AssistantTurnFooterLabels {
  /** Always-visible label; "" hides the footer text entirely. */
  label: string;
  /** Swapped in on hover (web) or tap (native); "" disables the swap. */
  hoverLabel: string;
}

export function getAssistantTurnFooterLabels(input: {
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  anchor?: AssistantTurnTimeAnchor;
  now?: Date;
}): AssistantTurnFooterLabels {
  const anchor = input.anchor ?? ASSISTANT_TURN_TIME_ANCHOR;
  const now = input.now ?? new Date();
  const started = input.startedAt ? `Started ${formatMessageTimestamp(input.startedAt, now)}` : "";
  const finished = input.completedAt
    ? `Finished ${formatMessageTimestamp(input.completedAt, now)}`
    : "";
  const duration = input.durationMs !== undefined ? formatDuration(input.durationMs) : "";

  // A time anchor missing its timestamp degrades to the bare duration, which
  // keeps the pre-anchor wording for streams whose timing lacks timestamps.
  const withDuration = (time: string) => {
    if (time && duration) return `${time} · ${duration}`;
    if (time) return time;
    return duration ? `Worked for ${duration}` : "";
  };

  if (anchor === "started") {
    return { label: withDuration(started), hoverLabel: finished };
  }
  if (anchor === "both") {
    return {
      label: withDuration([started, finished].filter(Boolean).join(" · ")),
      hoverLabel: "",
    };
  }
  return { label: withDuration(finished), hoverLabel: started };
}
