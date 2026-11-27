import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentQueueService } from "./agent-queue/service.js";
import { localApprovedTurn, type ApprovedTurnLedger } from "./local-approved-turn.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function setup() {
  const home = mkdtempSync(join(tmpdir(), "approved-turn-"));
  dirs.push(home);
  const dir = join(home, "openchat-machine");
  mkdirSync(dir, { mode: 0o700 });
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
    DatabaseSync: new (file: string) => ApprovedTurnLedger;
  };
  const file = join(dir, "authority.db"),
    db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(
    "CREATE TABLE grants(route,localProof,agent,workspace,mode,state,context,expires,offerUntil,stage,request,deadline,approvedHash,daemonTurn); CREATE TABLE scoped_receipts(route,turn)",
  );
  const item = randomBytes(16).toString("hex"),
    route = randomBytes(24).toString("hex"),
    proof = randomBytes(32).toString("hex");
  const text = "literal fixture",
    until = Date.now() + 60_000;
  db.prepare(
    "INSERT INTO grants VALUES(?,?,'agent','/test','auto','active','fresh',?,?,'reserved',?,?,?,NULL)",
  ).run(route, proof, until, until, item, until, createHash("sha256").update(text).digest("hex"));
  let items: { id: string }[] = [];
  const agent = {
    lifecycle: "idle",
    activeForegroundTurnId: null as string | null,
    pendingPermissions: new Map(),
    provider: "codex",
    cwd: "/test",
    currentModeId: "auto",
  };
  const queue = {
    subscribeToMutations: () => () => {},
    list: async () => ({ items }),
    remove: vi.fn(async (_agent: string, id: string) => {
      items = items.filter((i) => i.id !== id);
    }),
  };
  const manager = {
    getAgent: () => agent,
    freshContext: () => "fresh",
    hasInFlightRun: () => false,
    fetchTimeline: () => ({ epoch: "one", window: {} }),
    getTimelineRows: async () => [],
    streamAgent: vi.fn(),
    cancelExactForegroundTurn: vi.fn(),
  };
  const call = (op: "run" | "bind" | "cancel") =>
    localApprovedTurn(
      home,
      manager as unknown as AgentManager,
      queue as unknown as AgentQueueService,
      {
        type: "local.approved_turn.request",
        version: 1,
        requestId: "fixture",
        op,
        route,
        proof,
        item,
        text,
      },
    );
  return {
    agent,
    manager,
    call,
    db,
    queue,
    item,
    setItems: (ids: string[]) => {
      items = ids.map((id) => ({ id }));
    },
  };
}
it("removes only the revoked queue item when idle and retains uncertainty", async () => {
  const f = setup();
  try {
    f.db.exec("UPDATE grants SET state='revoked',stage='quarantined'");
    f.setItems([f.item, "different"]);
    expect((await f.call("cancel")).status).toBe("quarantined");
    expect(f.queue.remove.mock.calls).toEqual([["agent", f.item]]);
    expect(f.manager.cancelExactForegroundTurn).not.toHaveBeenCalled();
    expect((await f.queue.list()).items).toEqual([{ id: "different" }]);
  } finally {
    f.db.close();
  }
});
it("requires a checked interruption for the exact active turn", async () => {
  const f = setup();
  try {
    f.db.exec("UPDATE grants SET state='revoked',stage='submitting',daemonTurn='owned'");
    f.agent.activeForegroundTurnId = "unrelated";
    expect((await f.call("cancel")).status).toBe("quarantined");
    expect(f.manager.cancelExactForegroundTurn).not.toHaveBeenCalled();
    f.agent.activeForegroundTurnId = "owned";
    f.manager.cancelExactForegroundTurn.mockResolvedValue(false);
    expect((await f.call("cancel")).status).toBe("quarantined");
    expect(f.manager.cancelExactForegroundTurn).toHaveBeenCalledWith("agent", "owned");
  } finally {
    f.db.close();
  }
});
it.each(["revoke", "expiry", "mode", "workspace"])(
  "rechecks %s at actual submission after reservation",
  async (change) => {
    const f = setup();
    try {
      const submit = vi.fn();
      f.manager.streamAgent.mockImplementation((_id, _text, opts) =>
        (async function* () {
          expect(f.db.prepare("SELECT stage FROM grants").get()).toEqual({
            stage: "submitting",
          });
          if (change === "revoke") f.db.exec("UPDATE grants SET state='revoked'");
          if (change === "expiry") f.db.exec("UPDATE grants SET deadline=0");
          if (change === "mode") f.agent.currentModeId = "full-access";
          if (change === "workspace") f.agent.cwd = "/different";
          await opts.localSubmission("auto", "/test", submit);
          yield { type: "turn_started", turnId: "unexpected" };
        })(),
      );
      expect((await f.call("run")).status).toBe("quarantined");
      expect(f.manager.streamAgent).toHaveBeenCalledTimes(1);
      expect(submit).not.toHaveBeenCalled();
    } finally {
      f.db.close();
    }
  },
);
