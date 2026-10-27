import { expect, test } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { loadFirstMessage } from "./load";

type Index = Awaited<ReturnType<DaemonClient["listAgentTimelinePrompts"]>>;
type Page = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;
type Request = Parameters<DaemonClient["fetchAgentTimeline"]>[1];

function fixture() {
  const text = "Original request\n\n" + "Full prompt beyond the preview. ".repeat(80);
  const index: Index = {
    requestId: "index",
    agentId: "agent",
    epoch: "epoch",
    error: null,
    prompts: [
      { seq: 0, timestamp: "2026-10-25T12:00:00Z", preview: "Original request…" },
      { seq: 4000, timestamp: "2026-10-25T13:00:00Z", preview: "Latest request" },
    ],
  };
  const page: Page = {
    requestId: "page",
    agentId: "agent",
    agent: null,
    direction: "before",
    projection: "canonical",
    epoch: "epoch",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 0, maxSeq: 5000, nextSeq: 5001 },
    startCursor: { epoch: "epoch", seq: 0 },
    endCursor: { epoch: "epoch", seq: 0 },
    hasOlder: false,
    hasNewer: true,
    error: null,
    entries: [
      {
        provider: "codex",
        item: { type: "user_message", text },
        timestamp: "2026-10-25T12:00:00Z",
        seqStart: 0,
        seqEnd: 0,
        sourceSeqRanges: [{ startSeq: 0, endSeq: 0 }],
        collapsed: [],
      },
    ],
  };
  const requests: Array<{ agentId: string; options: Request }> = [];
  return {
    index,
    page,
    text,
    requests,
    client: {
      listAgentTimelinePrompts: async () => index,
      fetchAgentTimeline: async (agentId: string, options: Request) => {
        requests.push({ agentId, options });
        return page;
      },
    },
  };
}

test("reads the full first prompt with one bounded read, including sequence zero", async () => {
  const f = fixture();
  await expect(loadFirstMessage(f.client, "agent")).resolves.toEqual({
    text: f.text,
    timestamp: "2026-10-25T12:00:00Z",
  });
  expect(f.requests).toEqual([
    {
      agentId: "agent",
      options: {
        direction: "before",
        cursor: { epoch: "epoch", seq: 1 },
        limit: 1,
        projection: "canonical",
      },
    },
  ]);
});

test("does not substitute the newest message when the chat is empty", async () => {
  const f = fixture();
  f.index.prompts = [];
  await expect(loadFirstMessage(f.client, "agent")).resolves.toBeNull();
  expect(f.requests).toEqual([]);
});

test("rejects a replaced timeline instead of showing the wrong first message", async () => {
  const f = fixture();
  f.page.epoch = "replacement";
  await expect(loadFirstMessage(f.client, "agent")).rejects.toThrow("conversation changed");
});

test("rejects a missing indexed prompt instead of silently showing an empty chat", async () => {
  const f = fixture();
  f.page.entries = [];
  await expect(loadFirstMessage(f.client, "agent")).rejects.toThrow("conversation changed");
});

test("propagates a failed connection for the reader's retry UI", async () => {
  const f = fixture();
  f.client.listAgentTimelinePrompts = async () => {
    throw new Error("Disconnected");
  };
  await expect(loadFirstMessage(f.client, "agent")).rejects.toThrow("Disconnected");
  expect(f.requests).toEqual([]);
});
