import { describe, expect, it } from "vitest";
import {
  SESSION_PIN_LABEL,
  selectPinnedSessions,
  sessionPinnedAt,
  setSessionPinned,
  type PinnableSession,
} from "./model";

const older = "2026-10-06T12:00:00.000Z";
const newer = "2026-10-07T12:00:00.000Z";
function session(id: string, pin = older, serverId = "host-a"): PinnableSession {
  return { id, serverId, title: id, labels: { [SESSION_PIN_LABEL]: pin, role: "orchestrator" } };
}

describe("session favorites", () => {
  it("orders by pin time, deduplicates per daemon/session, and ignores activity/title changes", () => {
    const first = session("first", newer);
    const second = session("second");
    const otherHost = session("first", newer, "host-b");
    expect(selectPinnedSessions([second, first, otherHost, first])).toEqual([
      first,
      otherHost,
      second,
    ]);
    expect(selectPinnedSessions([{ ...second, title: "renamed" }, first])[0]).toBe(first);
  });

  it("hides archived/deleted sessions, restores archived pins, and rejects malformed labels", () => {
    const favorite = session("favorite");
    expect(
      selectPinnedSessions([
        { ...favorite, archivedAt: newer },
        session("bad", "true"),
        session("empty", ""),
      ]),
    ).toEqual([]);
    expect(selectPinnedSessions([{ ...favorite, archivedAt: null }])).toEqual([
      { ...favorite, archivedAt: null },
    ]);
    expect(selectPinnedSessions([])).toEqual([]);
  });

  it("writes only the pin label, preserves pin order on repeated requests, and unpins idempotently", async () => {
    let record = session("favorite", "");
    const patches: Record<string, string>[] = [];
    const update = async (id: string, patch: { labels: Record<string, string> }) => {
      expect(id).toBe(record.id);
      patches.push(patch.labels);
      record = { ...record, labels: { ...record.labels, ...patch.labels } };
    };
    await setSessionPinned(record, true, update, () => new Date(newer));
    await setSessionPinned(record, true, update, () => new Date());
    expect(patches).toEqual([{ [SESSION_PIN_LABEL]: newer }]);
    expect(record.labels.role).toBe("orchestrator");
    expect(sessionPinnedAt(record)).toBe(Date.parse(newer));
    await setSessionPinned(record, false, update);
    await setSessionPinned(record, false, update);
    expect(patches).toHaveLength(2);
    expect(selectPinnedSessions([record])).toEqual([]);
  });

  it("does not claim success or change the local record when the host rejects the write", async () => {
    const record = session("favorite", "");
    await expect(
      setSessionPinned(record, true, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(sessionPinnedAt(record)).toBeNull();
    await expect(
      setSessionPinned({ ...record, archivedAt: newer }, true, async () => {}),
    ).rejects.toThrow("Archived");
  });
});
