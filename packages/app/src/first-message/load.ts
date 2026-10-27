import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

type FirstMessageClient = Pick<DaemonClient, "listAgentTimelinePrompts" | "fetchAgentTimeline">;

export interface FirstMessage {
  text: string;
  timestamp: string;
}

/** Read the original prompt independently of the viewed timeline and its scroll window. */
export async function loadFirstMessage(
  client: FirstMessageClient,
  agentId: string,
): Promise<FirstMessage | null> {
  const index = await client.listAgentTimelinePrompts(agentId);
  const first = index.prompts[0];
  if (!first) return null;
  // `before` is exclusive. One canonical row before the next position is the full
  // prompt, even when the chat has thousands of turns and only its tail is loaded.
  const page = await client.fetchAgentTimeline(agentId, {
    direction: "before",
    cursor: { epoch: index.epoch, seq: first.seq + 1 },
    limit: 1,
    projection: "canonical",
  });
  const entry = page.entries.find((candidate) => candidate.seqStart === first.seq);
  if (page.epoch !== index.epoch || page.staleCursor || entry?.item.type !== "user_message") {
    throw new Error("The conversation changed while loading its first message.");
  }
  return { text: entry.item.text, timestamp: entry.timestamp };
}
