import type { TFunction } from "i18next";
import { formatDuration, formatMessageTimestamp } from "@/utils/time";

/** Keep completion visible; an unknown timestamp must not acquire a time from duration alone. */
export function getAssistantTurnFooterLabels(
  input: {
    startedAt?: Date;
    completedAt?: Date;
    durationMs?: number | null;
    now?: Date;
  },
  t: TFunction,
): { label: string; hoverLabel: string } {
  const now = input.now ?? new Date();
  const valid = (date: Date | undefined): date is Date =>
    date !== undefined && Number.isFinite(date.getTime());
  const finished = valid(input.completedAt)
    ? t("message.turnFooter.finishedAt", { time: formatMessageTimestamp(input.completedAt, now) })
    : "";
  const duration =
    typeof input.durationMs === "number" &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
      ? formatDuration(input.durationMs)
      : "";
  let label = duration ? t("message.turnFooter.workedFor", { duration }) : "";
  if (finished) label = [finished, duration].filter(Boolean).join(" · ");
  return {
    label,
    hoverLabel: valid(input.startedAt)
      ? t("message.turnFooter.startedAt", { time: formatMessageTimestamp(input.startedAt, now) })
      : "",
  };
}

export function getTurnDurationLabel(durationMs: number, t: TFunction): string {
  return t("message.turnFooter.workedFor", { duration: formatDuration(durationMs) });
}
