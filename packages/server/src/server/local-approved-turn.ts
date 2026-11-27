import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { NativeTurnEvidence } from "./agent/agent-sdk-types.js";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentQueueService } from "./agent-queue/service.js";

type Request = Extract<SessionInboundMessage, { type: "local.approved_turn.request" }>;
type Result = Omit<
  Extract<SessionOutboundMessage, { type: "local.approved_turn.response" }>["payload"],
  "requestId" | "version"
>;
export interface ApprovedTurnLedger {
  prepare(sql: string): {
    get(...values: (string | number)[]): unknown;
    run(...values: (string | number)[]): { changes: number | bigint };
  };
  exec(sql: string): void;
  close(): void;
}
interface Permit {
  agent: string;
  workspace: string;
  mode: string;
  state: string;
  context: string | null;
  expires: number;
  offerUntil: number;
  stage: string | null;
  request: string | null;
  deadline: number | null;
  approvedHash: string | null;
  daemonTurn: string | null;
  nativeThread: string | null;
  nativeTurn: string | null;
}

function isBoundStart(
  id: string | undefined,
  accepted: NativeTurnEvidence | undefined,
  previous: string | undefined,
): id is string {
  return !!id && id === accepted?.localId && (!previous || previous === id);
}
function assertPrivate(path: string, directory: boolean) {
  const st = lstatSync(path);
  if (
    (directory ? !st.isDirectory() : !st.isFile()) ||
    st.uid !== process.getuid?.() ||
    st.mode & 0o077 ||
    (!directory && st.nlink !== 1)
  )
    throw Error("Private operator state required");
}

// The fixed, OS-owner-only ledger is created by the local consent UI. The RPC
// cannot choose a file, create a grant, change its scope, or authorize text.
export async function localApprovedTurn(
  home: string,
  manager: AgentManager,
  queue: AgentQueueService | null,
  req: Request,
): Promise<Result> {
  if (!queue) return { status: "denied" };
  if (req.op === "probe") return { status: "supported" };
  if (!req.route || !req.proof) return { status: "denied" };
  const dir = join(home, "openchat-machine"),
    file = join(dir, "authority.db");
  let db: ApprovedTurnLedger | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    assertPrivate(dir, true);
    assertPrivate(file, false);
    const moduleName: string = "node:sqlite";
    const { DatabaseSync } = (await import(moduleName)) as {
      DatabaseSync: new (path: string) => ApprovedTurnLedger;
    };
    const ledger = new DatabaseSync(file);
    db = ledger;
    ledger.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL");
    const route = req.route;
    const row = () =>
      ledger
        .prepare("SELECT * FROM grants WHERE route=? AND localProof=?")
        .get(route, req.proof!) as unknown as Permit | undefined;
    const grant = row();
    if (!grant) return { status: "denied" };
    const g = grant;
    const context = manager.freshContext(g.agent);
    const snapshot = () => manager.getAgent(g.agent);
    const scope = () => {
      const agent = snapshot();
      return (
        agent &&
        agent.lifecycle === "idle" &&
        !agent.activeForegroundTurnId &&
        !agent.pendingPermissions.size &&
        !agent.pendingReplacement &&
        !agent.internal &&
        agent.provider === "codex" &&
        agent.cwd === g.workspace &&
        ["read-only", "auto"].includes(g.mode) &&
        agent.currentModeId === g.mode &&
        context &&
        manager.freshContext(g.agent) === context
      );
    };
    let queueChanged = false;
    unsubscribe = queue.subscribeToMutations((q) => {
      if (q.agentId === g.agent) queueChanged = true;
    });
    const clean = async () => (await queue.list(g.agent)).items.length === 0;
    const cancel = async (): Promise<Result> => {
      if (g.state !== "revoked" || !g.request || g.request !== req.item)
        return { status: "denied" };
      const items = (await queue.list(g.agent)).items;
      if (items.some((i) => i.id === req.item)) await queue.remove(g.agent, req.item);
      const active = snapshot()?.activeForegroundTurnId;
      if (
        active &&
        (!g.daemonTurn ||
          active !== g.daemonTurn ||
          !(await manager.cancelExactForegroundTurn(g.agent, active)))
      )
        return { status: "quarantined" };
      const cleared = await clean();
      const current = row(),
        agent = snapshot();
      if (
        !cleared ||
        !agent ||
        agent.lifecycle !== "idle" ||
        manager.hasInFlightRun(g.agent) ||
        current?.stage !== "native-terminal" ||
        !current.nativeThread ||
        !current.nativeTurn ||
        !current.daemonTurn
      )
        return { status: "quarantined" };
      return { status: "stopped", item: req.item, turnId: current.daemonTurn };
    };
    if (req.op === "cancel") return await cancel();
    if (!(await clean()) || queueChanged || !scope() || manager.hasInFlightRun(g.agent))
      return { status: "denied" };
    const position = () => {
      const tail = manager.fetchTimeline(g.agent, { direction: "tail", limit: 1 });
      return JSON.stringify([tail.epoch, tail.window]);
    };
    const cursor = position();
    const history = await manager.getTimelineRows(g.agent);
    if (cursor !== position()) return { status: "denied" };
    const bind = (): Result => {
      if (
        history.some(
          (r) =>
            r.item.type === "user_message" ||
            r.item.type === "assistant_message" ||
            r.item.type === "tool_call",
        ) ||
        snapshot()?.lastUserMessageAt ||
        queueChanged ||
        !scope() ||
        manager.hasInFlightRun(g.agent)
      )
        return { status: "denied" };
      const result = ledger
        .prepare(
          "UPDATE grants SET context=? WHERE route=? AND localProof=? AND state='pending' AND context IS NULL AND offerUntil>?",
        )
        .run(context!, route, req.proof!, Date.now());
      return { status: result.changes === 1 ? "bound" : "denied" };
    };
    if (req.op === "bind") return bind();
    const execute = async (): Promise<Result> => {
      if (
        req.op !== "run" ||
        !req.text?.trim() ||
        /^\s*\//u.test(req.text) ||
        !req.item ||
        context !== g.context
      )
        return { status: "denied" };
      const item = req.item,
        text = req.text,
        digest = createHash("sha256").update(text).digest("hex");
      // Every prior conversation row must belong to an earlier completed turn of this grant.
      const owned = ledger.prepare("SELECT 1 FROM scoped_receipts WHERE route=? AND turn=?");
      if (
        history.some(
          (r) =>
            ["user_message", "assistant_message", "tool_call"].includes(r.item.type) &&
            (!r.turnId || !owned.get(route, r.turnId)),
        )
      )
        return { status: "denied" };
      const allowed = (stage: string) => {
        const r = row(),
          now = Date.now();
        return (
          !!r &&
          r.state === "active" &&
          r.stage === stage &&
          r.context === context &&
          r.request === item &&
          r.approvedHash === digest &&
          r.deadline !== null &&
          r.deadline > now &&
          r.expires > now &&
          !queueChanged &&
          cursor === position() &&
          !!scope()
        );
      };
      if (!allowed("reserved") || manager.hasInFlightRun(g.agent)) return { status: "denied" };
      // Autocommit the uncertain-submission fence before touching the provider. A lost
      // process cannot expose a retryable state after the provider has accepted work.
      if (
        !ledger
          .prepare(
            "UPDATE grants SET stage='submitting' WHERE route=? AND request=? AND state='active' AND stage='reserved'",
          )
          .run(route, item).changes
      )
        return { status: "denied" };
      const run = async (): Promise<Result> => {
        let submitted = false,
          turnId: string | undefined,
          terminal = false;
        let accepted: NativeTurnEvidence | undefined,
          ended: Extract<NativeTurnEvidence, { kind: "terminal" }> | undefined;
        const evidence = (e: NativeTurnEvidence) => {
          if (!submitted || !e.thread || !e.turn || !e.localId)
            throw Error("Missing native binding");
          if (e.kind === "accepted" && !accepted) {
            // Native IDs must be unique across requests even when a process restarts.
            // Commit this claim before the provider exposes its interrupt target.
            ledger
              .prepare("INSERT INTO native_requests(thread,turn,route,request) VALUES(?,?,?,?)")
              .run(e.thread, e.turn, route, item);
            accepted = e;
            return;
          }
          if (
            e.kind !== "terminal" ||
            ended ||
            e.localId !== accepted?.localId ||
            e.thread !== accepted.thread ||
            e.turn !== accepted.turn
          )
            throw Error("Conflicting native binding");
          ended = e;
        };
        const stream = manager.streamAgent(g.agent, text, {
          clientMessageId: item,
          localTurnEvidence: evidence,
          localSubmission: (mode, cwd, submit) => {
            ledger.exec("BEGIN IMMEDIATE");
            try {
              if (submitted || !allowed("submitting") || mode !== g.mode || cwd !== g.workspace)
                throw Error("Local approval expired or changed");
              submitted = true;
              const started = submit();
              ledger.exec("COMMIT");
              return started;
            } catch (error) {
              ledger.exec("ROLLBACK");
              throw error;
            }
          },
        });
        for await (const e of stream) {
          if (!submitted) throw Error("Provider did not enforce literal admission");
          if (e.type === "turn_started") {
            if (!isBoundStart(e.turnId, accepted, turnId)) throw Error("Ambiguous provider start");
            turnId = e.turnId;
            ledger
              .prepare(
                "UPDATE grants SET daemonTurn=?,nativeThread=?,nativeTurn=? WHERE route=? AND request=?",
              )
              .run(turnId, accepted!.thread, accepted!.turn, route, item);
            if (row()?.state !== "active") {
              // Let the stream consume the terminal event while interruption awaits settlement.
              void manager.cancelExactForegroundTurn(g.agent, turnId).catch(() => false);
            }
          } else if (
            turnId &&
            (e.type === "turn_completed" || e.type === "turn_canceled") &&
            e.turnId === turnId
          ) {
            if (
              !ended ||
              ended.status !== (e.type === "turn_completed" ? "completed" : "interrupted")
            )
              throw Error("Missing native terminal acknowledgement");
            terminal = e.type === "turn_completed";
            ledger
              .prepare(
                "UPDATE grants SET stage='native-terminal' WHERE route=? AND request=? AND daemonTurn=? AND nativeThread=? AND nativeTurn=?",
              )
              .run(route, item, turnId, ended.thread, ended.turn);
          }
        }
        if (!terminal || !turnId || row()?.state !== "active") return { status: "quarantined" };
        return result(turnId, ended?.text);
      };
      const result = async (turnId: string, nativeText: string | undefined): Promise<Result> => {
        const rows = (await manager.getTimelineRows(g.agent)).filter((r) => r.turnId === turnId);
        const source = rows.filter((r) => r.item.type === "user_message");
        if (
          source.length !== 1 ||
          source[0].item.type !== "user_message" ||
          source[0].item.text !== text ||
          ![source[0].item.messageId, source[0].item.clientMessageId].includes(item)
        )
          return { status: "quarantined" };
        if (typeof nativeText !== "string" || !nativeText || row()?.state !== "active")
          return { status: "quarantined" };
        ledger.prepare("INSERT INTO scoped_receipts(route,turn) VALUES(?,?)").run(route, turnId);
        return {
          status: "result",
          turnId,
          item,
          text: nativeText.slice(0, 12000),
        };
      };
      return run();
    };
    return await execute();
  } catch {
    return {
      status: req.op === "run" || req.op === "cancel" ? "quarantined" : "denied",
    };
  } finally {
    unsubscribe?.();
    db?.close();
  }
}
