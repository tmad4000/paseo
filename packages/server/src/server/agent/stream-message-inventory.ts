import { createHash } from "node:crypto";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { ProjectedTimelineRow } from "./timeline-projection.js";

type MessageRow = ProjectedTimelineRow & {
  item: Extract<ProjectedTimelineRow["item"], { type: "user_message" | "assistant_message" }>;
};

/** Retained message coverage, deliberately not a guess at semantic asks. No model calls. */
export function indexStreamMessages(
  entries: CompanionEntry[],
  rows: readonly ProjectedTimelineRow[],
  epoch: string,
): CompanionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  // Other provenance hashes a record has been matched under (e.g. the provider ID a
  // client-keyed prompt gained later), so a replay carrying only that ID still finds it.
  const byAlias = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.messageReview) continue;
    for (const alias of entry.source?.aliases ?? []) byAlias.set(alias, entry.id);
  }
  let changed = false;
  for (const row of rows) {
    if (row.item.type !== "user_message" && row.item.type !== "assistant_message") continue;
    const messageRow = row as MessageRow;
    const candidates = provenanceCandidates(messageRow, epoch);
    const previous = findSourceRecord(candidates, byId, byAlias);
    const next = previous
      ? refreshSourceRecord(previous, candidates, messageRow, epoch, byId)
      : newSourceRecord(candidates[0], messageRow, epoch);
    if (!next) continue;
    byId.set(next.id, next);
    for (const alias of next.source?.aliases ?? []) byAlias.set(alias, next.id);
    changed = true;
  }
  changed = refreshAskSourcePositions(byId) || changed;
  return changed ? [...byId.values()] : entries;
}

// Text/ordinal is not identity: a retained window can drop an earlier identical
// message. Only provider/client provenance may carry review across epochs.
// Without it, preserve the old record and create an unreviewed local observation.
// A submitted prompt is recorded under its client ID and may gain a provider ID later,
// so an existing record is matched under any provenance the row carries. New records key
// on the provider ID when it is already known (provider history replays carry only that),
// otherwise on the client ID, which survives later enrichment.
function provenanceCandidates(row: MessageRow, epoch: string): string[] {
  const { item } = row;
  const role = item.type === "user_message" ? "user" : "agent";
  const clientId = item.type === "user_message" ? item.clientMessageId : undefined;
  const identities: (string | number)[][] = [];
  if (row.providerMessageId) identities.push(["provider", row.providerMessageId]);
  if (clientId) identities.push(["client", clientId]);
  if (item.messageId) identities.push(["provider", item.messageId]);
  if (identities.length === 0) identities.push(["local", epoch, row.seqStart, row.seqEnd]);
  return identities.map((identity) => {
    const digest = createHash("sha256")
      .update(JSON.stringify([role, identity, item.text]))
      .digest("hex");
    return `message:${digest}`;
  });
}

function findSourceRecord(
  candidates: string[],
  byId: Map<string, CompanionEntry>,
  byAlias: Map<string, string>,
): CompanionEntry | undefined {
  const matches = candidates
    .map((candidate) => byId.get(`source:${candidate}`) ?? byId.get(byAlias.get(candidate) ?? ""))
    .filter((entry): entry is CompanionEntry => entry !== undefined);
  return matches.find((entry) => entry.messageReview?.state === "reviewed") ?? matches[0];
}

function refreshSourceRecord(
  previous: CompanionEntry,
  candidates: string[],
  row: MessageRow,
  epoch: string,
  byId: Map<string, CompanionEntry>,
): CompanionEntry | undefined {
  const known = new Set([previous.source?.messageId, ...(previous.source?.aliases ?? [])]);
  // Never alias another record's own key.
  const added = candidates.filter(
    (candidate) => !known.has(candidate) && !byId.has(`source:${candidate}`),
  );
  const moved = previous.source?.seq !== row.seqEnd || previous.source?.epoch !== epoch;
  if (added.length === 0 && !moved) return undefined;
  const aliases = [...(previous.source?.aliases ?? []), ...added].slice(0, 8);
  return {
    ...previous,
    source: {
      role: row.item.type === "user_message" ? "user" : "agent",
      messageId: previous.source?.messageId ?? candidates[0],
      seq: row.seqEnd,
      epoch,
      ...(aliases.length > 0 ? { aliases } : {}),
    },
  };
}

function newSourceRecord(messageId: string, row: MessageRow, epoch: string): CompanionEntry {
  const { item } = row;
  const role = item.type === "user_message" ? "user" : "agent";
  const common = {
    id: `source:${messageId}`,
    timestamp: row.timestamp,
    text: item.text.slice(0, 4000),
    truncated: item.text.length > 4000,
    source: { role, messageId, seq: row.seqEnd, epoch } as const,
  };
  return role === "user"
    ? {
        ...common,
        kind: "question",
        status: "open",
        messageReview: { state: "unreviewed", revision: 0, note: "", askIds: [] },
      }
    : { ...common, kind: "q_and_a" };
}

function refreshAskSourcePositions(byId: Map<string, CompanionEntry>): boolean {
  let changed = false;
  const sources = new Map(
    [...byId.values()]
      .filter((entry) => entry.messageReview && entry.source)
      .map((entry) => {
        const { aliases: _aliases, ...position } = entry.source!;
        return [position.messageId, position] as const;
      }),
  );
  for (const entry of byId.values()) {
    const source = entry.ask?.sourceMessageId ? sources.get(entry.ask.sourceMessageId) : undefined;
    if (source && (entry.source?.seq !== source.seq || entry.source?.epoch !== source.epoch)) {
      byId.set(entry.id, { ...entry, source });
      changed = true;
    }
  }
  return changed;
}
