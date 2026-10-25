import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const Entry = z.object({ id: z.string(), role: z.enum(["user", "assistant"]), text: z.string() });
const Context = z.object({
  epoch: z.string().regex(/^[A-Za-z0-9_-]{1,134}$/),
  mode: z.enum(["conversation", "listen"]),
  muted: z.boolean(),
  unconfirmedInput: z.boolean().default(false),
  destination: z.enum(["assistant", "agent"]).default("assistant"),
  entries: z.array(Entry),
  draft: z.array(Entry),
  deliveries: z.record(z.string(), z.enum(["pending", "accepted", "unknown"])),
});
export type RealtimeContext = z.infer<typeof Context>;

/** Synchronous atomic writes serialize admission before an external queue effect. No raw audio. */
export class RealtimeContextStore {
  private readonly path: string;
  private readonly directory: string;
  constructor(home: string, agentId: string) {
    z.guid().parse(agentId);
    this.directory = join(home, "voice-contexts", agentId);
    this.path = join(this.directory, "current.json");
  }
  read(): RealtimeContext {
    if (!existsSync(this.path)) {
      const fresh = this.fresh(false, "conversation");
      this.write(fresh);
      return fresh;
    }
    // Corrupt/unreadable history is an error, never implicit permission to forget it.
    return Context.parse(JSON.parse(readFileSync(this.path, "utf8")));
  }
  write(context: RealtimeContext): void {
    // A revoked attachment may finish an already-admitted operation after a new attachment starts.
    // Receipt states only advance; stale context snapshots cannot erase a settled outcome.
    if (existsSync(this.path)) {
      const previous = Context.parse(JSON.parse(readFileSync(this.path, "utf8")));
      const rank = { pending: 0, unknown: 1, accepted: 2 };
      for (const [id, state] of Object.entries(previous.deliveries)) {
        const next = context.deliveries[id];
        if (!next || rank[state] > rank[next]) context.deliveries[id] = state;
      }
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(context), { mode: 0o600 });
    renameSync(temp, this.path);
  }
  clear(expectedEpoch: string, requestId: string): RealtimeContext {
    z.string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .parse(requestId);
    const context = this.read();
    // A retry cannot clear the newly created epoch a second time.
    const nextEpoch = `clear-${requestId}`;
    if (context.epoch === nextEpoch) return context;
    if (context.epoch !== expectedEpoch)
      throw new Error("Voice context changed; refresh before clearing.");
    writeFileSync(join(this.directory, `${context.epoch}.json`), JSON.stringify(context), {
      mode: 0o600,
    });
    const fresh = this.fresh(context.muted, context.mode);
    fresh.epoch = nextEpoch;
    fresh.deliveries = context.deliveries;
    this.write(fresh);
    return fresh;
  }
  private fresh(muted: boolean, mode: RealtimeContext["mode"]): RealtimeContext {
    return {
      epoch: randomUUID(),
      unconfirmedInput: false,
      destination: "assistant",
      mode,
      muted,
      entries: [],
      draft: [],
      deliveries: {},
    };
  }
}

export function realtimeHistory(context: RealtimeContext, maxChars = 24000) {
  const result: RealtimeContext["entries"] = [];
  let length = 0;
  for (const entry of context.entries.toReversed()) {
    if (length + entry.text.length > maxChars) break;
    result.unshift(entry);
    length += entry.text.length;
  }
  return { entries: result, omitted: context.entries.length - result.length };
}
