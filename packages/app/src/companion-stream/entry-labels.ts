import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface EntryEyebrow {
  kind: string;
  status: string;
}

const PERMISSION_KINDS = {
  question: "question",
  plan: "decision",
  tool: "permission",
  mode: "permission",
  other: "permission",
} as const;

/** The muted line above a Stream card: what this is and where it stands. Provenance stays in data. */
export function describeEntry(entry: CompanionEntry, t: Translate): EntryEyebrow {
  switch (entry.kind) {
    case "question":
      if (entry.ask)
        return {
          kind: t("agentPanel.stream.card.ask"),
          status: t(`agentPanel.stream.card.askState.${entry.ask.state}`),
        };
      return {
        kind: t(
          entry.id.startsWith("turn:")
            ? "agentPanel.stream.card.inferredQuestion"
            : "agentPanel.stream.question",
        ),
        status: t(`agentPanel.stream.card.status.${entry.status}`),
      };
    case "feature_request":
      return {
        kind: t("agentPanel.stream.card.featureRequest"),
        status: t(`agentPanel.stream.card.status.${entry.status}`),
      };
    case "permission":
      return {
        kind: t(`agentPanel.stream.${PERMISSION_KINDS[entry.requestKind]}`),
        status: t(
          entry.status === "pending"
            ? "agentPanel.stream.pendingStatus"
            : `agentPanel.stream.${entry.status}`,
        ),
      };
    case "pin":
      return {
        kind: t(entry.sourceId ? "agentPanel.stream.card.quote" : "agentPanel.stream.card.note"),
        status: "",
      };
    case "q_and_a":
      return { kind: t("agentPanel.stream.card.qAndA"), status: "" };
    case "outcome":
      return { kind: t(`agentPanel.stream.${entry.status}`), status: "" };
  }
}

/** First non-empty line is the card headline; the rest is body copy. */
export function splitEntryText(text: string): { headline: string; rest: string } {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first === -1) return { headline: "", rest: "" };
  return {
    headline: lines[first].trim(),
    rest: lines
      .slice(first + 1)
      .join("\n")
      .trim(),
  };
}
