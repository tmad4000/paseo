import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { GlobalStreamRow } from "./use-global-stream";

/** A copied snapshot can be read as context, but cannot become a second task authority. */
export function streamCardSource(row: GlobalStreamRow) {
  const entry = row.item.kind === "entry" ? row.item.entry : undefined;
  const origin = entry?.ask?.canonicalTask ?? entry?.ask?.origin;
  const copiedTask = Boolean(
    origin &&
    (origin.serverId !== row.serverId ||
      origin.agentId !== row.agentId ||
      origin.entryId !== entry?.id),
  );
  return {
    entry,
    copiedTask,
    serverId: origin?.serverId ?? row.serverId,
    agentId: origin?.agentId ?? row.agentId,
    workspaceId: copiedTask ? undefined : row.workspaceId,
  };
}

export function hasUnseenReply(entry: CompanionEntry | undefined): boolean {
  return Boolean(entry?.reply && (entry.replySeenRevision ?? 0) < entry.reply.revision);
}
