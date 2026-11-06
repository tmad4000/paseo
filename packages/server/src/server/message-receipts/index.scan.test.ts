import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const io = vi.hoisted(() => ({ readdirCalls: 0, inFlightReads: 0, maxInFlightReads: 0 }));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      io.readdirCalls++;
      return actual.readdir(...args);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      io.inFlightReads++;
      io.maxInFlightReads = Math.max(io.maxInFlightReads, io.inFlightReads);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await actual.readFile(...args);
      } finally {
        io.inFlightReads--;
      }
    },
  };
});

const { MessageReceipts } = await import("./index.js");

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
  Object.assign(io, { readdirCalls: 0, inFlightReads: 0, maxInFlightReads: 0 });
});

async function fixtureWithReceipts(count: number) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-requests-scan-"));
  directories.push(directory);
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      writeFile(
        path.join(directory, `${String(index).padStart(6, "0")}.json`),
        JSON.stringify({
          fingerprint: `f${index}`,
          state: "completed",
          agentId: index % 2 === 0 ? "even" : "odd",
          messageId: `m${index}`,
          createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
        }),
      ),
    ),
  );
  Object.assign(io, { readdirCalls: 0, inFlightReads: 0, maxInFlightReads: 0 });
  return { directory, receipts: new MessageReceipts(directory) };
}

test("listing a large receipt directory keeps only a small read window open", async () => {
  const { receipts } = await fixtureWithReceipts(400);
  const listed = await receipts.listForAgent("even");
  expect(listed).toHaveLength(200);
  // One descriptor per in-flight read; unbounded reads held all 400 at once.
  expect(io.maxInFlightReads).toBeLessThanOrEqual(16);
});

test("concurrent listings share one directory scan", async () => {
  const { receipts } = await fixtureWithReceipts(120);
  const results = await Promise.all([
    receipts.listForAgent("even"),
    receipts.listForAgent("odd"),
    ...Array.from({ length: 8 }, () => receipts.listForAgent("even")),
  ]);
  expect(io.readdirCalls).toBe(1);
  expect(results[0]).toHaveLength(60);
  expect(results[1]).toHaveLength(60);
  expect(io.maxInFlightReads).toBeLessThanOrEqual(16);
});

test("a listing after a write never reuses a scan that predates it", async () => {
  const { receipts } = await fixtureWithReceipts(40);
  const before = receipts.listForAgent("new-agent");
  await receipts.send({
    agentId: "new-agent",
    messageId: "fresh",
    request: { text: "hi" },
    send: async () => {},
  });
  const after = await receipts.listForAgent("new-agent");
  expect(await before).toHaveLength(0);
  expect(after.map((receipt) => receipt.messageId)).toEqual(["fresh"]);
  expect(io.readdirCalls).toBe(2);
});
