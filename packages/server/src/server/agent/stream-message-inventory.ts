import { createHash } from "node:crypto";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { ProjectedTimelineRow } from "./timeline-projection.js";

/** Retained message coverage, deliberately not a guess at semantic asks. No model calls. */
export function indexStreamMessages(
  entries: CompanionEntry[],
  rows: readonly ProjectedTimelineRow[],
  epoch: string,
): CompanionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let changed = false;
  for (const row of rows) {
    const { item } = row;
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    const role = item.type === "user_message" ? "user" : "agent";
    // Text/ordinal is not identity: a retained window can drop an earlier identical
    // message. Only provider/client provenance may carry review across epochs.
    // Without it, preserve the old record and create an unreviewed local observation.
    // A submitted prompt is recorded under its client ID and gains a provider ID later,
    // so match an existing record under any provenance the row carries; new records use
    // the client ID first because it survives that enrichment.
    const clientId = item.type === "user_message" ? item.clientMessageId : undefined;
    const identities: (string | number)[][] = [];
    if (clientId) identities.push(["client", clientId]);
    for (const providerId of [row.providerMessageId, item.messageId]) {
      if (providerId) identities.push(["provider", providerId]);
    }
    if (identities.length === 0) identities.push(["local", epoch, row.seqStart, row.seqEnd]);
    const candidates = identities.map((identity) => {
      const digest = createHash("sha256")
        .update(JSON.stringify([role, identity, item.text]))
        .digest("hex");
      return `message:${digest}`;
    });
    const messageId =
      candidates.find((candidate) => byId.has(`source:${candidate}`)) ?? candidates[0];
    const id = `source:${messageId}`;
    const previous = byId.get(id);
    const source = { role, messageId, seq: row.seqEnd, epoch } as const;
    if (previous) {
      if (previous.source?.seq !== source.seq || previous.source?.epoch !== epoch) {
        byId.set(id, { ...previous, source });
        changed = true;
      }
      continue;
    }
    const common = {
      id,
      timestamp: row.timestamp,
      text: item.text.slice(0, 4000),
      truncated: item.text.length > 4000,
      source,
    };
    byId.set(
      id,
      role === "user"
        ? {
            ...common,
            kind: "question",
            status: "open",
            messageReview: { state: "unreviewed", revision: 0, note: "", askIds: [] },
          }
        : { ...common, kind: "q_and_a" },
    );
    changed = true;
  }
  changed = refreshAskSourcePositions(byId) || changed;
  return changed ? [...byId.values()] : entries;
}

function refreshAskSourcePositions(byId: Map<string, CompanionEntry>): boolean {
  let changed = false;
  const sources = new Map(
    [...byId.values()]
      .filter((entry) => entry.messageReview)
      .map((entry) => [entry.source?.messageId, entry.source]),
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
