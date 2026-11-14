import type { TFunction } from "i18next";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { SubthreadGroupKind, SubthreadRow, SubthreadSummary } from "./model";

/**
 * The name a person knows a model by ("Opus 5.5"), from the host's provider catalog. Falls back
 * to the id the agent reports, so a card never hides its model just because the catalog has not
 * loaded or the model is a custom one.
 */
export function resolveModelLabel(
  entries: readonly ProviderSnapshotEntry[] | undefined,
  provider: string,
  modelId: string | null,
): string | null {
  if (!modelId) return null;
  const models = entries?.find((entry) => entry.provider === provider)?.models;
  const match = models?.find((model) => model.id === modelId || model.aliases?.includes(modelId));
  return match?.label?.trim() || modelId;
}

/** A mode's label from the same catalog, else its id. */
export function resolveModeLabel(
  entries: readonly ProviderSnapshotEntry[] | undefined,
  provider: string,
  modeId: string | null,
): string | null {
  if (!modeId) return null;
  const modes = entries?.find((entry) => entry.provider === provider)?.modes;
  return modes?.find((mode) => mode.id === modeId)?.label?.trim() || modeId;
}

/** One phrase per state, in the sidebar's status vocabulary, for cards and screen readers. */
export function subthreadStateLabel(t: TFunction, row: SubthreadRow): string {
  if (row.needsInput) return t("subthreads.state.needsInput");
  if (row.bucket === "failed") return t("subthreads.state.failed");
  if (row.bucket === "running") return t("subthreads.state.working");
  if (row.unread) return t("subthreads.state.unread");
  return t("subthreads.state.done");
}

export function subthreadGroupName(t: TFunction, kind: SubthreadGroupKind): string {
  return kind === "paseo" ? t("subthreads.groups.spawned") : t("subthreads.groups.provider");
}

/**
 * A group's attention parts, in the order the spec fixes: needs input, failed, working. Zero
 * parts are omitted; the count is the heading's own.
 */
export function groupSummaryParts(t: TFunction, summary: SubthreadSummary): string[] {
  const parts: string[] = [];
  if (summary.needsInput === 1) parts.push(t("subthreads.summary.needsInputOne"));
  if (summary.needsInput > 1) {
    parts.push(t("subthreads.summary.needsInputMany", { count: summary.needsInput }));
  }
  if (summary.failed > 0) parts.push(t("subthreads.summary.failed", { count: summary.failed }));
  if (summary.running > 0) parts.push(t("subthreads.summary.working", { count: summary.running }));
  return parts;
}

/** "Spawned agents, 3, 1 needs input, 1 working": what a heading announces. */
export function groupAccessibilityLabel(
  t: TFunction,
  kind: SubthreadGroupKind,
  summary: SubthreadSummary,
): string {
  return [
    subthreadGroupName(t, kind),
    String(summary.total),
    ...groupSummaryParts(t, summary),
  ].join(", ");
}
