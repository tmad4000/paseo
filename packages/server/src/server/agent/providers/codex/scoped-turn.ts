import type { NativeTurnEvidence } from "../../agent-sdk-types.js";

function record(x: unknown): Record<string, unknown> | undefined {
  return x && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : undefined;
}

type Event =
  | { kind: "answer"; id: string; text: string }
  | { kind: "terminal"; id: string; status: "completed" | "interrupted" | "failed" };

function event(method: string, p: Record<string, unknown>): Event | undefined {
  if (method === "item/completed") {
    const item = record(p.item);
    if (
      typeof p.turnId === "string" &&
      item?.type === "agentMessage" &&
      typeof item.text === "string"
    )
      return { kind: "answer", id: p.turnId, text: item.text.slice(0, 12000) };
  }
  if (method === "turn/completed") {
    const turn = record(p.turn);
    if (!turn || typeof turn.id !== "string" || (p.turnId !== undefined && p.turnId !== turn.id))
      return;
    const status = turn.status;
    if (status === "completed" || status === "interrupted" || status === "failed")
      return { kind: "terminal", id: turn.id, status };
  }
}

// One instance belongs to the JSON-RPC request that wrote turn/start. The response to
// that request is the only source of the native turn ID. Notifications never select it.
export class ScopedCodexTurn {
  nativeId?: string;
  private pending: Event[] = [];
  private invalid = false;
  private terminal = false;
  private text?: string;
  constructor(
    readonly localId: string,
    readonly thread: string,
    private readonly evidence: (value: NativeTurnEvidence) => void,
    private readonly started: () => void,
    private readonly finished: (
      status: "completed" | "interrupted" | "failed",
      text?: string,
    ) => void,
  ) {}

  acknowledge(reply: unknown) {
    const body = record(reply),
      turn = record(body?.turn);
    if (
      this.invalid ||
      !body ||
      typeof turn?.id !== "string" ||
      !turn.id.trim() ||
      turn.id.length > 256 ||
      [body.threadId, turn.threadId].some((t) => t !== undefined && t !== this.thread)
    )
      throw Error("Missing or ambiguous native start acknowledgement");
    this.evidence({ localId: this.localId, thread: this.thread, turn: turn.id, kind: "accepted" });
    this.nativeId = turn.id;
    this.started();
    const buffered = this.pending;
    this.pending = [];
    for (const e of buffered) this.consume(e);
  }

  notification(method: string, params: unknown) {
    if (this.invalid || this.terminal) return;
    const p = record(params);
    if (!p || p.threadId !== this.thread) return;
    const e = event(method, p);
    if (!e) return;
    if (this.nativeId) this.consume(e);
    else if (this.pending.length < 64 && e.id.length <= 256) this.pending.push(e);
    else {
      this.invalid = true;
      this.pending = [];
    }
  }

  private consume(e: Event) {
    if (this.terminal || e.id !== this.nativeId) return;
    if (e.kind === "answer") {
      this.text = e.text;
      return;
    }
    this.terminal = true;
    this.evidence({
      kind: "terminal",
      localId: this.localId,
      thread: this.thread,
      turn: e.id,
      status: e.status,
      text: this.text,
    });
    this.finished(e.status, this.text);
  }
}
