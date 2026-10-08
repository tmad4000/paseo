import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  applyAliasRepair,
  inspectAliasRepair,
  type AliasRepairPlan,
} from "./reconcile-queue-alias.mjs";
import { MessageReceipts } from "../packages/server/src/server/message-receipts/index.js";
import { acquirePidLock, releasePidLock } from "../packages/server/src/server/pid-lock.js";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return { server, port: address.port };
}
async function fixture(
  run: (f: {
    home: string;
    output: string;
    plan: AliasRepairPlan;
    aliasBytes: Buffer;
    canonicalBytes: Buffer;
    root: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "paseo-alias-repair-test-"));
  const home = join(root, "home");
  await mkdir(join(home, "queues"), { recursive: true });
  await mkdir(join(home, "agent-requests"));
  const alias = "c74ccc0e",
    canonicalId = "c74ccc0e-1634-4cea-adf3-a31a0ff89f35",
    itemId = "664ddbfa-6269-433d-9f55-6be4d66b0330";
  const aliasBytes = Buffer.from(
    JSON.stringify(
      {
        agentId: alias,
        revision: 1,
        items: [
          { id: itemId, text: "Reviewed completed request", createdAt: "2026-10-07T07:05:53.581Z" },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  const canonicalBytes = Buffer.from(
    JSON.stringify({ agentId: canonicalId, revision: 97, items: [] }) + "\n",
  );
  await writeFile(join(home, "queues", alias + ".json"), aliasBytes);
  await writeFile(join(home, "queues", canonicalId + ".json"), canonicalBytes);
  await writeFile(
    join(home, "queues", alias + ".journal.jsonl"),
    '{"historical":"journal entry"}\n',
  );
  await writeFile(join(home, "queues", "original-six.json"), '{"items":[1,2,3,4,5,6]}\n');
  await writeFile(
    join(home, "agent-requests", "unknown.json"),
    '{"state":"pending","retained":true}\n',
  );
  const ack = join(root, "ack.txt");
  await writeFile(ack, "Original owner acknowledged the reviewed item.\n");
  const { server, port } = await reservePort();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const plan: AliasRepairPlan = {
    home,
    mustBeStoppedPids: [2147483647],
    alias,
    canonicalId,
    itemId,
    expectedAliasSha256: hash(aliasBytes),
    expectedCanonicalSha256: hash(canonicalBytes),
    ownerAcknowledgement: { path: ack, sha256: hash(await readFile(ack)) },
    listen: { host: "127.0.0.1", port },
  };
  try {
    await run({ home, output: join(root, "evidence"), plan, aliasBytes, canonicalBytes, root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function unchanged(home: string, plan: AliasRepairPlan, alias: Buffer, canonical: Buffer) {
  assert.deepEqual(await readFile(join(home, "queues", plan.alias + ".json")), alias);
  assert.deepEqual(await readFile(join(home, "queues", plan.canonicalId + ".json")), canonical);
  assert.equal(
    await readFile(join(home, "queues", "original-six.json"), "utf8"),
    '{"items":[1,2,3,4,5,6]}\n',
  );
  assert.equal(
    await readFile(join(home, "agent-requests", "unknown.json"), "utf8"),
    '{"state":"pending","retained":true}\n',
  );
}

test("journals the one alias acknowledgement and prevents replay under either spelling", async () =>
  fixture(async ({ home, output, plan, aliasBytes, canonicalBytes }) => {
    const receipt = await applyAliasRepair(plan, output);
    assert.equal(receipt.phase, "verified");
    assert.equal(receipt.remaining, 0);
    assert.equal(receipt.revision, 2);
    assert.deepEqual(
      await readFile(join(output, "original", "queues", plan.alias + ".json")),
      aliasBytes,
    );
    assert.deepEqual(
      await readFile(join(home, "queues", plan.canonicalId + ".json")),
      canonicalBytes,
    );
    assert.equal(
      await readFile(join(home, "queues", "original-six.json"), "utf8"),
      '{"items":[1,2,3,4,5,6]}\n',
    );
    assert.equal(
      await readFile(join(home, "agent-requests", "unknown.json"), "utf8"),
      '{"state":"pending","retained":true}\n',
    );
    const journal = (await readFile(join(home, "queues", plan.alias + ".journal.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(journal[0], { historical: "journal entry" });
    assert.deepEqual(journal[1].before, JSON.parse(aliasBytes.toString()));
    assert.deepEqual(journal[1].after.items, []);
    const receipts = new MessageReceipts(join(home, "agent-requests"));
    let sends = 0;
    for (const agentId of [plan.alias, plan.canonicalId]) {
      await receipts.send({
        agentId,
        messageId: plan.itemId,
        request: { prompt: "Reviewed completed request", activeTurnBehavior: "interrupt" },
        send: async () => {
          sends++;
        },
      });
    }
    assert.equal(sends, 0);
    assert(!(await readdir(home)).includes("paseo.pid"));
  }));

for (const changed of ["alias", "canonical", "acknowledgement"] as const)
  test("rejects changed " + changed + " bytes before mutations", async () =>
    fixture(async ({ home, output, plan, aliasBytes, canonicalBytes }) => {
      if (changed === "alias") plan.expectedAliasSha256 = "0".repeat(64);
      else if (changed === "canonical") plan.expectedCanonicalSha256 = "0".repeat(64);
      else plan.ownerAcknowledgement.sha256 = "0".repeat(64);
      await assert.rejects(applyAliasRepair(plan, output), /changed/);
      await unchanged(home, plan, aliasBytes, canonicalBytes);
      assert(!(await readdir(home)).includes("paseo.pid"));
    }),
  );

for (const spelling of ["alias", "canonicalId"] as const)
  test("preserves unknown pending receipt under " + spelling, async () =>
    fixture(async ({ home, output, plan, aliasBytes, canonicalBytes }) => {
      const receipts = new MessageReceipts(join(home, "agent-requests"));
      await assert.rejects(
        receipts.send({
          agentId: plan[spelling],
          messageId: plan.itemId,
          request: { prompt: "Reviewed completed request", activeTurnBehavior: "interrupt" },
          send: async () => {
            throw new Error("unknown provider result");
          },
        }),
      );
      const names = await readdir(join(home, "agent-requests"));
      await assert.rejects(applyAliasRepair(plan, output), /Unresolved.*pending/);
      assert.deepEqual(await readdir(join(home, "agent-requests")), names);
      assert.equal(await receipts.get(plan[spelling], plan.itemId), "pending");
      await unchanged(home, plan, aliasBytes, canonicalBytes);
    }),
  );

test("refuses a live daemon PID without touching its lock or persisted work", async () =>
  fixture(async ({ home, output, plan, aliasBytes, canonicalBytes }) => {
    await acquirePidLock(home, "127.0.0.1:" + plan.listen.port);
    const lock = await readFile(join(home, "paseo.pid"));
    assert.equal((await inspectAliasRepair(plan)).daemon.locked, true);
    await assert.rejects(applyAliasRepair(plan, output), /OFFLINE_MAINTENANCE_REQUIRED/);
    assert.deepEqual(await readFile(join(home, "paseo.pid")), lock);
    await unchanged(home, plan, aliasBytes, canonicalBytes);
    await releasePidLock(home);
  }));

test("refuses an orphan listener even when no supervisor lock exists", async () =>
  fixture(async ({ home, output, plan, aliasBytes, canonicalBytes }) => {
    const { server, port } = await reservePort();
    plan.listen.port = port;
    try {
      await assert.rejects(applyAliasRepair(plan, output), /EADDRINUSE/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await unchanged(home, plan, aliasBytes, canonicalBytes);
    assert(!(await readdir(home)).includes("paseo.pid"));
  }));

test("does not reuse an existing evidence directory", async () =>
  fixture(async ({ home, output, plan, aliasBytes, canonicalBytes }) => {
    await mkdir(output);
    await writeFile(join(output, "existing"), "original evidence");
    await assert.rejects(applyAliasRepair(plan, output), /EEXIST/);
    assert.equal(await readFile(join(output, "existing"), "utf8"), "original evidence");
    await unchanged(home, plan, aliasBytes, canonicalBytes);
  }));

test("refuses an observed worker even if its supervisor lock and listener disappeared", async () =>
  fixture(async ({ home, output, plan, aliasBytes, canonicalBytes }) => {
    plan.mustBeStoppedPids = [process.pid];
    await assert.rejects(applyAliasRepair(plan, output), /observed processes still running/);
    await unchanged(home, plan, aliasBytes, canonicalBytes);
    assert(!(await readdir(home)).includes("paseo.pid"));
  }));

test(
  "retains originals and prevents replay when journal append fails after tombstoning",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  async () =>
    fixture(async ({ home, output, plan, aliasBytes, canonicalBytes }) => {
      const journal = join(home, "queues", plan.alias + ".journal.jsonl");
      await chmod(journal, 0o400);
      try {
        await assert.rejects(applyAliasRepair(plan, output), /EACCES/);
        await unchanged(home, plan, aliasBytes, canonicalBytes);
        assert.deepEqual(
          await readFile(join(output, "original", "queues", plan.alias + ".json")),
          aliasBytes,
        );
        const failure = JSON.parse(await readFile(join(output, "failure.json"), "utf8"));
        assert.equal(failure.automaticRetry, false);
        assert.equal(failure.restoreOriginalsAutomatically, false);
        const receipts = new MessageReceipts(join(home, "agent-requests"));
        let replays = 0;
        for (const agentId of [plan.alias, plan.canonicalId]) {
          assert.equal(await receipts.get(agentId, plan.itemId), "removed");
          await receipts.send({
            agentId,
            messageId: plan.itemId,
            request: { prompt: "Reviewed completed request", activeTurnBehavior: "interrupt" },
            send: async () => {
              replays++;
            },
          });
        }
        assert.equal(replays, 0);
      } finally {
        await chmod(journal, 0o600);
      }
    }),
);
