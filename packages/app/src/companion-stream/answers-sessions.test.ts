import { describe, expect, it } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { StreamItem } from "@/types/stream";
import {
  SESSION_IDLE_GAP_MS,
  chatMessageEvents,
  computeChatSessions,
  entryTime,
  placeEntry,
  segmentRows,
  type ChatSessions,
} from "./answers-sessions";

// Local wall-clock times, so day boundaries hold in any time zone the tests run in.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);

let seq = 0;
function user(
  timestamp: Date,
  text = "hello",
  extra: Partial<Extract<StreamItem, { kind: "user_message" }>> = {},
): StreamItem {
  seq += 1;
  return {
    kind: "user_message",
    id: `u${seq}`,
    text,
    timestamp,
    timelineCursor: { epoch: "e1", seq },
    ...extra,
  };
}
function assistant(timestamp: Date): StreamItem {
  seq += 1;
  return {
    kind: "assistant_message",
    id: `a${seq}`,
    text: "ok",
    timestamp,
    timelineCursor: { epoch: "e1", seq },
  };
}
function tool(timestamp: Date): StreamItem {
  return { kind: "thought", id: `t${timestamp.getTime()}`, text: "…", timestamp } as StreamItem;
}
const heartbeat = (timestamp: Date) =>
  user(timestamp, "<paseo-system>\nHeartbeat: check CI\n</paseo-system>");

function sessionsOf(items: StreamItem[], historyComplete = true): ChatSessions {
  return computeChatSessions(chatMessageEvents(items), { historyComplete });
}

function entry(id: string, timestamp: string | Date, extra: Partial<CompanionEntry> = {}) {
  return {
    id,
    kind: "question",
    status: "open",
    timestamp: typeof timestamp === "string" ? timestamp : timestamp.toISOString(),
    text: id,
    truncated: false,
    ask: { state: "in_progress", remaining: "", evidence: "", revision: 1, provenance: "explicit" },
    ...extra,
  } as CompanionEntry;
}

describe("computeChatSessions", () => {
  it("starts a session only after more than two hours without a real message", () => {
    const exactly = sessionsOf([user(at(30, 9)), assistant(new Date(at(30, 9).getTime() + 1))]);
    expect(exactly.sessions).toHaveLength(1);
    const twoHours = at(30, 9).getTime() + SESSION_IDLE_GAP_MS;
    const atLimit = sessionsOf([user(at(30, 9)), user(new Date(twoHours))]);
    expect(atLimit.sessions).toHaveLength(1);
    const over = sessionsOf([user(at(30, 9)), user(new Date(twoHours + 1))]);
    expect(over.sessions.map((s) => s.origin)).toEqual(["start", "idle"]);
    expect(over.sessions[1]!.idleMs).toBe(SESSION_IDLE_GAP_MS + 1);
  });

  it("measures quiet from the last message, assistant replies included", () => {
    const chat = sessionsOf([user(at(30, 9)), assistant(at(30, 10, 30)), user(at(30, 12, 0))]);
    expect(chat.sessions).toHaveLength(1);
    expect(chat.sessions[0]!.end).toBe(at(30, 12).getTime());
  });

  it("ignores tool rows, heartbeats and the replies to them", () => {
    const chat = sessionsOf([
      user(at(30, 9)),
      tool(at(30, 10)),
      heartbeat(at(30, 10, 30)),
      assistant(at(30, 10, 31)),
      tool(at(30, 10, 32)),
      user(at(30, 12, 0)),
    ]);
    // 09:00 to 12:00 is three quiet hours: the heartbeat turn did not bridge it.
    expect(chat.sessions.map((s) => s.origin)).toEqual(["start", "idle"]);
    expect(chat.sessions[1]!.idleMs).toBe(3 * 60 * 60 * 1000);
    expect(sessionsOf([heartbeat(at(30, 9)), assistant(at(30, 9, 1))]).sessions).toEqual([]);
  });

  it("leaves out messages with unusable timestamps", () => {
    const chat = sessionsOf([user(new Date(Number.NaN)), user(at(30, 9))]);
    expect(chat.sessions).toHaveLength(1);
    expect(chat.sessions[0]!.start).toBe(at(30, 9).getTime());
  });

  it("marks a fork's inherited history as its own boundary", () => {
    const fork = user(at(30, 9), "Continue", {
      attachments: [
        { type: "text", mimeType: "text/plain", contextKind: "chat_history", text: "…" },
      ],
    } as Partial<Extract<StreamItem, { kind: "user_message" }>>);
    const chat = sessionsOf([fork, assistant(at(30, 9, 5)), user(at(30, 9, 30))]);
    expect(chat.forkAt).toBe(at(30, 9).getTime());
    expect(chat.sessions.map((s) => s.origin)).toEqual(["fork"]);
  });

  it("does not claim a chat start it has not loaded", () => {
    expect(sessionsOf([user(at(30, 9))], false).sessions[0]!.origin).toBe("partial");
  });

  it("does not count replies whose prompt is unloaded, which may have been a heartbeat", () => {
    const chat = sessionsOf([assistant(at(30, 6)), user(at(30, 9))], false);
    expect(chat.sessions.map((s) => [s.origin, s.start])).toEqual([
      ["partial", at(30, 9).getTime()],
    ]);
  });
});

describe("placeEntry", () => {
  const items = [
    user(at(30, 9)),
    assistant(at(30, 9, 5)),
    user(at(30, 10, 30)),
    assistant(at(30, 11, 45)),
    user(at(30, 13, 0)),
    // Session two starts after 4h of quiet and runs past local midnight.
    user(at(30, 23, 30)),
    assistant(at(31, 0, 40)),
  ];
  const chat = sessionsOf(items);

  it("computes breaks from the whole chat, so filtered rows cannot fake one", () => {
    // 09:00 and 13:00 are four hours apart, but messages in between keep one session.
    const early = placeEntry(entry("early", at(30, 9, 1)), chat);
    const late = placeEntry(entry("late", at(30, 13, 1)), chat);
    expect(early.key).toBe(late.key);
    expect(early.kind).toBe("session");
    expect(early.time).toBe(at(30, 9).getTime());
  });

  it("splits a session at local midnight, and starts the next session at the idle break", () => {
    const evening = placeEntry(entry("evening", at(30, 23, 35)), chat);
    const night = placeEntry(entry("night", at(31, 0, 41)), chat);
    expect(evening.kind).toBe("session");
    expect(evening.session?.origin).toBe("idle");
    expect(night.kind).toBe("day");
    expect(night.time).toBe(at(31, 0).getTime());
    expect(night.session).toBe(evening.session);
    expect(night.key).not.toBe(evening.key);
  });

  it("places an entry by its source message before its own timestamp", () => {
    const question = items[2]!;
    const qa = {
      id: "qa",
      kind: "q_and_a",
      timestamp: at(31, 0, 41).toISOString(),
      text: "q",
      truncated: false,
      questionAnchor: {
        epoch: "e1",
        startSeq: question.timelineCursor!.seq,
        endSeq: question.timelineCursor!.seq,
      },
    } as CompanionEntry;
    expect(entryTime(qa, chat.times)).toBe(at(30, 10, 30).getTime());
    const ask = entry("ask", at(31, 0, 41), {
      ask: {
        state: "open",
        remaining: "",
        evidence: "",
        revision: 1,
        provenance: "explicit",
        sourceMessageId: question.id,
      },
    });
    expect(placeEntry(ask, chat).key).toBe(placeEntry(entry("x", at(30, 9, 1)), chat).key);
  });

  it("keeps unknown times, older-than-loaded history and fork inheritance apart", () => {
    expect(placeEntry(entry("bad", "not a date"), chat).kind).toBe("unknown");
    const partial = sessionsOf([user(at(30, 9))], false);
    const older = placeEntry(entry("older", at(29, 15)), partial);
    expect(older.kind).toBe("earlier");
    expect(older.time).toBe(at(29, 0).getTime());
    const forked = sessionsOf([
      user(at(30, 9), "Continue", {
        attachments: [
          { type: "text", mimeType: "text/plain", contextKind: "chat_history", text: "…" },
        ],
      } as Partial<Extract<StreamItem, { kind: "user_message" }>>),
    ]);
    expect(placeEntry(entry("parent", at(29, 15)), forked).kind).toBe("inherited");
    expect(placeEntry(entry("own", at(30, 9, 10)), forked).session?.origin).toBe("fork");
  });
});

describe("segmentRows", () => {
  it("orders segments newest first and keeps each segment's item order", () => {
    const chat = sessionsOf([user(at(30, 9)), user(at(30, 14))]);
    const items = [
      entry("blocked-old", at(30, 9, 10)),
      entry("unknown", "?"),
      entry("open-new", at(30, 14, 5)),
      entry("open-old", at(30, 9, 20)),
    ];
    const rows = segmentRows(items, (item) => placeEntry(item, chat));
    expect(
      rows.map((row) => (row.type === "divider" ? `| ${row.segment.kind}` : row.item.id)),
    ).toEqual([
      "| session",
      "open-new",
      "| session",
      "blocked-old",
      "open-old",
      "| unknown",
      "unknown",
    ]);
  });
});
