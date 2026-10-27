/** Offline maintenance only: never starts a daemon or replays a provider prompt. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import { AgentQueueStore } from "../packages/server/src/server/agent-queue/store.js";
import { MessageReceipts } from "../packages/server/src/server/message-receipts/index.js";
import {
  acquirePidLock,
  getPidLockInfo,
  isLocked,
  releasePidLock,
} from "../packages/server/src/server/pid-lock.js";

export interface AliasRepairPlan {
  home: string;
  mustBeStoppedPids: number[];
  alias: string;
  canonicalId: string;
  itemId: string;
  expectedAliasSha256: string;
  expectedCanonicalSha256: string;
  ownerAcknowledgement: { path: string; sha256: string };
  listen: { host: "127.0.0.1"; port: number };
}
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function durableWrite(file: string, bytes: string | Buffer) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function inventory(home: string) {
  const files: Record<string, Buffer> = {};
  for (const directory of ["queues", "agent-requests"]) {
    for (const name of await readdir(join(home, directory))) {
      if (!name.endsWith(".json") && !name.endsWith(".jsonl")) continue;
      const relative = join(directory, name);
      files[relative] = await readFile(join(home, relative));
    }
  }
  return files;
}
function receiptName(agentId: string, itemId: string) {
  return join("agent-requests", digest(JSON.stringify(["send", agentId, itemId])) + ".json");
}
function validatePlan(plan: AliasRepairPlan) {
  if (
    !/^[a-f0-9]{8,31}$/.test(plan.alias) ||
    !uuid.test(plan.canonicalId) ||
    !plan.canonicalId.startsWith(plan.alias) ||
    !uuid.test(plan.itemId)
  )
    throw new Error("Invalid alias, canonical ID, or item ID");
  if (
    plan.listen.host !== "127.0.0.1" ||
    !Number.isInteger(plan.listen.port) ||
    plan.listen.port < 1024 ||
    plan.listen.port > 65535
  )
    throw new Error("Expected explicit loopback maintenance port");
}
function observedRunningPids(plan: AliasRepairPlan) {
  if (
    !Array.isArray(plan.mustBeStoppedPids) ||
    plan.mustBeStoppedPids.length === 0 ||
    plan.mustBeStoppedPids.some((pid) => !Number.isInteger(pid) || pid <= 0)
  )
    throw new Error("Explicit observed supervisor/worker PIDs are required");
  const runningPids = plan.mustBeStoppedPids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  });
  return runningPids;
}
export async function inspectAliasRepair(plan: AliasRepairPlan) {
  validatePlan(plan);
  const acknowledgement = await readFile(plan.ownerAcknowledgement.path);
  if (digest(acknowledgement) !== plan.ownerAcknowledgement.sha256)
    throw new Error("Owner acknowledgement changed");
  const aliasBytes = await readFile(join(plan.home, "queues", plan.alias + ".json"));
  const canonicalBytes = await readFile(join(plan.home, "queues", plan.canonicalId + ".json"));
  if (digest(aliasBytes) !== plan.expectedAliasSha256) throw new Error("Alias queue changed");
  if (digest(canonicalBytes) !== plan.expectedCanonicalSha256)
    throw new Error("Canonical queue changed");
  const store = new AgentQueueStore(join(plan.home, "queues"));
  const alias = await store.get(plan.alias);
  const canonical = await store.get(plan.canonicalId);
  if (alias.agentId !== plan.alias || canonical.agentId !== plan.canonicalId)
    throw new Error("Queue identity mismatch");
  if (alias.items.length !== 1 || alias.items[0].id !== plan.itemId || canonical.items.length !== 0)
    throw new Error("Expected one reviewed alias item and an empty canonical queue");
  const item = alias.items[0];
  if (
    item.origin ||
    item.images?.length ||
    item.attachments?.length ||
    item.composerAttachments?.length
  )
    throw new Error("Only reviewed plain text alias items are supported");
  const request = { prompt: item.text, activeTurnBehavior: "interrupt" };
  const receipts = new MessageReceipts(join(plan.home, "agent-requests"));
  const states: Record<string, string> = {};
  for (const id of [plan.alias, plan.canonicalId]) {
    states[id] = await receipts.get(id, plan.itemId, request);
    if (!["absent", "removed"].includes(states[id]))
      throw new Error("Unresolved or previously submitted receipt: " + id + "=" + states[id]);
  }
  const runningPids = observedRunningPids(plan);
  const daemon = await isLocked(plan.home);
  return {
    aliasBytes,
    canonicalBytes,
    acknowledgement,
    alias,
    request,
    states,
    daemon,
    runningPids,
  };
}

async function verifyReconciliation(
  plan: AliasRepairPlan,
  before: Awaited<ReturnType<typeof inspectAliasRepair>>,
  files: Record<string, Buffer>,
  after: Record<string, Buffer>,
  receipts: MessageReceipts,
) {
  const allowed = new Set([
    join("queues", plan.alias + ".json"),
    join("queues", plan.alias + ".journal.jsonl"),
    receiptName(plan.alias, plan.itemId),
    receiptName(plan.canonicalId, plan.itemId),
  ]);
  for (const file of new Set([...Object.keys(files), ...Object.keys(after)])) {
    if (!allowed.has(file) && (!files[file] || !after[file] || !files[file].equals(after[file])))
      throw new Error("Unrelated persisted data changed: " + file);
  }
  const journalName = join("queues", plan.alias + ".journal.jsonl");
  const originalJournal = files[journalName] ?? Buffer.alloc(0);
  if (!after[journalName].subarray(0, originalJournal.length).equals(originalJournal))
    throw new Error("Original journal prefix changed");
  const appended = JSON.parse(
    after[journalName].subarray(originalJournal.length).toString().trim(),
  );
  if (
    JSON.stringify(appended.before) !== JSON.stringify(before.alias) ||
    appended.after.items.length !== 0 ||
    appended.after.revision !== before.alias.revision + 1
  )
    throw new Error("Journal verification failed");
  for (const id of [plan.alias, plan.canonicalId])
    if ((await receipts.get(id, plan.itemId, before.request)) !== "removed")
      throw new Error("Missing removal tombstone");
}

/** Caller must explicitly authorize an offline maintenance window; this never stops Paseo. */
export async function applyAliasRepair(plan: AliasRepairPlan, output: string) {
  const before = await inspectAliasRepair(plan);
  if (before.runningPids.length)
    throw new Error(
      "OFFLINE_MAINTENANCE_REQUIRED: observed processes still running: " +
        before.runningPids.join(","),
    );
  if (before.daemon.locked)
    throw new Error(
      "OFFLINE_MAINTENANCE_REQUIRED: daemon PID " +
        before.daemon.info?.pid +
        " is running; no files changed",
    );
  if (resolve(output).startsWith(resolve(plan.home) + "/"))
    throw new Error("Evidence directory must be outside daemon home");
  // Acquire Paseo's own exclusive process lock so its supervisor cannot restart during repair.
  await acquirePidLock(plan.home, null);
  const ownership = await getPidLockInfo(plan.home);
  const listener = createServer((socket) => socket.destroy());
  let listening = false;
  let outputCreated = false;
  try {
    // A surviving worker can outlive its supervisor; reserve its exact listen address too.
    await new Promise<void>((ok, fail) => {
      listener.once("error", fail);
      listener.listen(plan.listen.port, plan.listen.host, () => {
        listening = true;
        ok();
      });
    });
    await inspectAliasRepair(plan); // Recheck hashes and receipts under exclusive ownership.
    const files = await inventory(plan.home);
    await mkdir(output, { mode: 0o700 }); // Exclusive attempt directory; never overwrite a previous attempt.
    outputCreated = true;
    await durableWrite(join(output, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
    await durableWrite(join(output, "owner-acknowledgement.original"), before.acknowledgement);
    const manifest: Record<string, string> = {};
    for (const [relative, bytes] of Object.entries(files)) {
      await mkdir(join(output, "original", relative.split("/")[0]), {
        recursive: true,
        mode: 0o700,
      });
      await durableWrite(join(output, "original", relative), bytes);
      manifest[relative] = digest(bytes);
    }
    await durableWrite(
      join(output, "original-sha256.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await inspectAliasRepair(plan); // No queue/receipt writes before all recoverable originals exist.
    const receipts = new MessageReceipts(join(plan.home, "agent-requests"));
    // Tombstone both spellings before changing the queue. A crash cannot replay this acknowledged item.
    for (const agentId of [plan.canonicalId, plan.alias]) {
      if (
        !(await receipts.recordRemoved({
          agentId,
          messageId: plan.itemId,
          request: before.request,
        }))
      )
        throw new Error("Receipt changed during reconciliation");
    }
    // Production store owns monotonic revision, fsynced before/after journal, and atomic replacement.
    const store = new AgentQueueStore(join(plan.home, "queues"), Number.MAX_SAFE_INTEGER);
    const result = await store.mutate(plan.alias, async (current) => {
      if (
        digest(await readFile(join(plan.home, "queues", plan.alias + ".json"))) !==
        plan.expectedAliasSha256
      )
        throw new Error("Alias changed before acknowledgement");
      if (JSON.stringify(current) !== JSON.stringify(before.alias))
        throw new Error("Alias payload changed");
      return { ...current, items: [] };
    });
    const after = await inventory(plan.home);
    await verifyReconciliation(plan, before, files, after, receipts);
    const receipt = {
      phase: "verified",
      finishedAt: new Date().toISOString(),
      alias: plan.alias,
      canonicalId: plan.canonicalId,
      itemId: plan.itemId,
      revision: result.queue.revision,
      remaining: result.queue.items.length,
      originalAliasSha256: plan.expectedAliasSha256,
      originalJournalPreserved: true,
      unrelatedQueuesAndReceiptsUnchanged: true,
      bothReceiptSpellingsRemoved: true,
      providerPromptsSent: 0,
      daemonStarts: 0,
      daemonStops: 0,
    };
    await durableWrite(join(output, "finish.json"), JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
  } catch (error) {
    if (outputCreated)
      await writeFile(
        join(output, "failure.json"),
        JSON.stringify(
          {
            phase: "needs_inspection",
            error: String(error),
            automaticRetry: false,
            restoreOriginalsAutomatically: false,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
    throw error;
  } finally {
    if (listening) await new Promise<void>((done) => listener.close(() => done()));
    await releasePidLock(plan.home, { startedAt: ownership?.startedAt });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, planFile, output] = process.argv.slice(2);
  if (
    !["inspect", "apply-offline"].includes(mode) ||
    !planFile ||
    (mode === "apply-offline" && !output)
  )
    throw new Error(
      "Usage: node --import tsx scripts/reconcile-queue-alias.mts inspect PLAN | apply-offline PLAN NEW_EVIDENCE_DIRECTORY",
    );
  const plan = JSON.parse(await readFile(planFile, "utf8")) as AliasRepairPlan;
  if (mode === "inspect") {
    const result = await inspectAliasRepair(plan);
    process.stdout.write(
      JSON.stringify({
        eligiblePayload: true,
        alias: plan.alias,
        itemId: plan.itemId,
        daemonRunning: result.daemon.locked,
        daemonPid: result.daemon.info?.pid,
        observedProcessesStillRunning: result.runningPids,
        applyRequiresOfflineMaintenance: true,
        writes: 0,
      }) + "\n",
    );
  } else process.stdout.write(JSON.stringify(await applyAliasRepair(plan, output)) + "\n");
}
