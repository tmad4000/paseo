import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  buildSendBackText,
  collectThreadReplies,
  latestAssistantReply,
  NO_THREAD_REPLIES,
  SEND_BACK_MAX_CHARS,
  THREAD_ANCHOR_LABEL,
  THREAD_PARENT_LABEL,
  threadAnchorKey,
  threadLabels,
  threadOriginOf,
  threadRepliesEqual,
} from "./model";

function agent(
  id: string,
  labels: Record<string, string>,
  extra: { createdAt?: number; archived?: boolean; title?: string } = {},
) {
  return {
    id,
    title: extra.title ?? `Thread ${id}`,
    createdAt: new Date(extra.createdAt ?? 0),
    archivedAt: extra.archived ? new Date(1) : null,
    labels,
  };
}

function assistant(text: string, turnId?: string): StreamItem {
  return {
    kind: "assistant_message",
    id: `a-${text}`,
    text,
    timestamp: new Date(0),
    ...(turnId ? { turnId } : {}),
  } as StreamItem;
}

function user(text: string): StreamItem {
  return { kind: "user_message", id: `u-${text}`, text, timestamp: new Date(0) } as StreamItem;
}

describe("thread anchors and labels", () => {
  it("prefers the message id and falls back to the timeline position", () => {
    expect(threadAnchorKey({ boundaryMessageId: "msg-1" })).toBe("msg-1");
    expect(
      threadAnchorKey({ boundaryCursor: { epoch: "e", seq: 7 }, boundaryMessageId: "m" }),
    ).toBe("m");
    expect(threadAnchorKey({ boundaryCursor: { epoch: "e", seq: 7 } })).toBe("cursor:e:7");
    expect(threadAnchorKey({})).toBeNull();
  });

  it("round-trips the link through labels and ignores partial links", () => {
    const labels = threadLabels({ parentAgentId: "parent", anchor: "msg-1" });
    expect(labels).toEqual({ [THREAD_PARENT_LABEL]: "parent", [THREAD_ANCHOR_LABEL]: "msg-1" });
    expect(threadOriginOf({ labels })).toEqual({ parentAgentId: "parent", anchor: "msg-1" });
    expect(threadOriginOf({ labels: { [THREAD_PARENT_LABEL]: "parent" } })).toBeNull();
    expect(threadOriginOf(null)).toBeNull();
  });
});

describe("collectThreadReplies", () => {
  it("groups a parent's live threads by anchor, oldest first", () => {
    const replies = collectThreadReplies(
      [
        agent("b", threadLabels({ parentAgentId: "p", anchor: "m1" }), { createdAt: 20 }),
        agent("a", threadLabels({ parentAgentId: "p", anchor: "m1" }), { createdAt: 10 }),
        agent("c", threadLabels({ parentAgentId: "p", anchor: "m2" })),
        agent("other", threadLabels({ parentAgentId: "q", anchor: "m1" })),
        agent("gone", threadLabels({ parentAgentId: "p", anchor: "m1" }), { archived: true }),
        agent("plain", {}),
      ],
      "p",
    );
    expect(replies.get("m1")?.map((reply) => reply.agentId)).toEqual(["a", "b"]);
    expect(replies.get("m2")?.map((reply) => reply.agentId)).toEqual(["c"]);
    expect(replies.size).toBe(2);
  });

  it("returns the shared empty map and compares structurally", () => {
    expect(collectThreadReplies([agent("plain", {})], "p")).toBe(NO_THREAD_REPLIES);
    const make = () =>
      collectThreadReplies([agent("a", threadLabels({ parentAgentId: "p", anchor: "m1" }))], "p");
    expect(threadRepliesEqual(make(), make())).toBe(true);
    expect(threadRepliesEqual(make(), NO_THREAD_REPLIES)).toBe(false);
  });
});

describe("latestAssistantReply", () => {
  it("joins every block of the last turn and stops at the previous prompt", () => {
    expect(
      latestAssistantReply([
        user("first"),
        assistant("old answer", "t1"),
        user("second"),
        assistant("part one", "t2"),
        assistant("part two", "t2"),
      ]),
    ).toBe("part one\n\npart two");
  });

  it("is null before the thread answers", () => {
    expect(latestAssistantReply([user("question")])).toBeNull();
    expect(latestAssistantReply([])).toBeNull();
  });
});

describe("buildSendBackText", () => {
  it("quotes the answer with provenance", () => {
    expect(
      buildSendBackText({
        threadTitle: "Retry policy",
        threadAgentId: "abc",
        reply: "Yes.\n\nDo it.",
      }),
    ).toBe('From the side thread "Retry policy" (Paseo session abc):\n\n> Yes.\n>\n> Do it.');
  });

  it("clips long answers", () => {
    const text = buildSendBackText({
      threadTitle: "t",
      threadAgentId: "a",
      reply: "x".repeat(SEND_BACK_MAX_CHARS + 50),
    });
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThan(SEND_BACK_MAX_CHARS + 100);
  });
});
