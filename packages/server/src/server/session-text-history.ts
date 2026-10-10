import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeConfigDir, claudeProjectDirSync } from "./agent/providers/claude/project-dir.js";
import type { SessionTextSearchMessage } from "./session-text-search.js";

/**
 * Read-only conversation text for agents the daemon has not loaded, for the sidebar's message
 * search (docs/sidebar-filter.md).
 *
 * Paseo's agent records hold no messages, and the in-memory timeline only exists for agents that
 * were opened since the daemon started. The text lives in the provider's own transcript, which
 * the record's `persistence` handle names. Resuming the agent would read it too, but that spawns
 * the provider and registers the agent; this module only opens files:
 *
 * - Claude: `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<encoded cwd>/<sessionId>.jsonl`
 * - Codex: `<CODEX_HOME or ~/.codex>/{sessions/YYYY/MM/DD,archived_sessions}/rollout-*-<threadId>.jsonl`
 *
 * Other providers (OpenCode, ACP agents such as Gemini, Pi) keep history behind their own
 * runtimes, so they are searched only while loaded.
 *
 * Bounds: only the last `maxBytes` of a transcript are read, at most `maxMessages` messages are
 * kept and each is capped at `maxMessageChars`. Results are cached per agent and activity stamp,
 * so repeated keystrokes do not re-read files, and the cache is evicted oldest-first past
 * `maxCachedChars` total.
 */

export interface PersistedConversationSource {
  agentId: string;
  provider: string;
  cwd: string;
  persistence: { provider?: string; sessionId?: string } | null | undefined;
  /** Changes whenever the transcript may have grown; part of the cache key. */
  activityStamp: string;
}

export interface PersistedConversationReaderOptions {
  claudeConfigDir?: () => string;
  codexHome?: () => string;
  maxBytes?: number;
  maxMessages?: number;
  maxMessageChars?: number;
  maxCachedChars?: number;
  /** How long a Codex rollout index is trusted before a miss rescans it. */
  codexIndexTtlMs?: number;
  now?: () => number;
}

const DEFAULTS = {
  maxBytes: 1024 * 1024,
  maxMessages: 400,
  maxMessageChars: 8000,
  maxCachedChars: 16 * 1024 * 1024,
  codexIndexTtlMs: 30_000,
};

// Codex injects these as user-role messages; they are not things the person typed.
const CODEX_INJECTED_PREFIXES = [
  "# AGENTS.md instructions",
  "<environment_context>",
  "<user_instructions>",
  "<INSTRUCTIONS>",
  "<permissions instructions>",
];

const ROLLOUT_THREAD_ID =
  /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

interface CacheEntry {
  stamp: string;
  messages: SessionTextSearchMessage[];
  chars: number;
}

export class PersistedConversationReader {
  private readonly options: Required<Omit<PersistedConversationReaderOptions, "now">> & {
    now: () => number;
  };
  private readonly cache = new Map<string, CacheEntry>();
  private cachedChars = 0;
  private codexIndex: { builtAt: number; home: string; paths: Map<string, string> } | null = null;

  constructor(options: PersistedConversationReaderOptions = {}) {
    this.options = {
      claudeConfigDir: options.claudeConfigDir ?? (() => claudeConfigDir(process.env)),
      codexHome: options.codexHome ?? (() => process.env.CODEX_HOME ?? join(homedir(), ".codex")),
      maxBytes: options.maxBytes ?? DEFAULTS.maxBytes,
      maxMessages: options.maxMessages ?? DEFAULTS.maxMessages,
      maxMessageChars: options.maxMessageChars ?? DEFAULTS.maxMessageChars,
      maxCachedChars: options.maxCachedChars ?? DEFAULTS.maxCachedChars,
      codexIndexTtlMs: options.codexIndexTtlMs ?? DEFAULTS.codexIndexTtlMs,
      now: options.now ?? Date.now,
    };
  }

  /** Messages oldest first. Unknown providers, missing files, and parse failures read as []. */
  async read(source: PersistedConversationSource): Promise<SessionTextSearchMessage[]> {
    const cached = this.cache.get(source.agentId);
    if (cached && cached.stamp === source.activityStamp) {
      // Refresh recency for eviction.
      this.cache.delete(source.agentId);
      this.cache.set(source.agentId, cached);
      return cached.messages;
    }
    let messages: SessionTextSearchMessage[] = [];
    try {
      messages = await this.readUncached(source);
    } catch {
      messages = [];
    }
    this.store(source.agentId, source.activityStamp, messages);
    return messages;
  }

  private async readUncached(source: PersistedConversationSource) {
    const sessionId = source.persistence?.sessionId;
    if (!sessionId) return [];
    const provider = source.persistence?.provider ?? source.provider;
    if (provider === "claude") {
      const path = join(
        claudeProjectDirSync(source.cwd, { configDir: this.options.claudeConfigDir() }),
        `${sessionId}.jsonl`,
      );
      return this.parseLines(await this.readTail(path), parseClaudeLine);
    }
    if (provider === "codex") {
      const path = await this.findCodexRollout(sessionId);
      return path ? this.parseLines(await this.readTail(path), parseCodexLine) : [];
    }
    return [];
  }

  private async readTail(path: string): Promise<string[]> {
    const handle = await open(path, "r");
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, this.options.maxBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const lines = buffer.toString("utf8").split(/\r?\n/);
      // A tail that starts mid-file starts mid-line; drop the fragment.
      if (length < size) lines.shift();
      return lines;
    } finally {
      await handle.close();
    }
  }

  private parseLines(
    lines: readonly string[],
    parse: (record: unknown) => SessionTextSearchMessage | null,
  ): SessionTextSearchMessage[] {
    const messages: SessionTextSearchMessage[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const message = parse(record);
      if (!message || !message.text.trim()) continue;
      messages.push({ ...message, text: message.text.slice(0, this.options.maxMessageChars) });
    }
    return messages.slice(-this.options.maxMessages);
  }

  private async findCodexRollout(threadId: string): Promise<string | null> {
    const home = this.options.codexHome();
    const now = this.options.now();
    const index = this.codexIndex;
    const fresh =
      index && index.home === home && now - index.builtAt < this.options.codexIndexTtlMs;
    const hit = index?.home === home ? index.paths.get(threadId) : undefined;
    if (hit) return hit;
    if (fresh) return null;
    const paths = new Map<string, string>();
    await collectRollouts(join(home, "sessions"), 3, paths);
    await collectRollouts(join(home, "archived_sessions"), 0, paths);
    this.codexIndex = { builtAt: now, home, paths };
    return paths.get(threadId) ?? null;
  }

  private store(agentId: string, stamp: string, messages: SessionTextSearchMessage[]) {
    const previous = this.cache.get(agentId);
    if (previous) {
      this.cachedChars -= previous.chars;
      this.cache.delete(agentId);
    }
    const chars = messages.reduce((sum, message) => sum + message.text.length, 0);
    this.cache.set(agentId, { stamp, messages, chars });
    this.cachedChars += chars;
    for (const [key, entry] of this.cache) {
      if (this.cachedChars <= this.options.maxCachedChars) break;
      this.cache.delete(key);
      this.cachedChars -= entry.chars;
    }
  }
}

/** Walks `depth` directory levels (YYYY/MM/DD) and indexes `rollout-*-<threadId>.jsonl`. */
async function collectRollouts(dir: string, depth: number, into: Map<string, string>) {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (depth > 0) {
      if ((await stat(path).catch(() => null))?.isDirectory()) {
        await collectRollouts(path, depth - 1, into);
      }
      continue;
    }
    const match = ROLLOUT_THREAD_ID.exec(name);
    if (match && name.startsWith("rollout-")) into.set(match[1]!.toLowerCase(), path);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function textParts(content: unknown, types: readonly string[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const record = asRecord(part);
      return record && types.includes(String(record.type)) && typeof record.text === "string"
        ? [record.text]
        : [];
    })
    .join("\n");
}

function roleOf(value: unknown): "user" | "assistant" | null {
  if (value === "user") return "user";
  if (value === "assistant") return "assistant";
  return null;
}

function timestampOf(record: Record<string, unknown>): string | undefined {
  return typeof record.timestamp === "string" ? record.timestamp : undefined;
}

/** Claude Code transcript line: `{type: "user"|"assistant", message: {content}}`. */
export function parseClaudeLine(value: unknown): SessionTextSearchMessage | null {
  const record = asRecord(value);
  if (!record || record.isSidechain === true || record.isMeta === true) return null;
  const role = roleOf(record.type);
  const message = asRecord(record.message);
  if (!role || !message) return null;
  // Tool results arrive as user entries; only typed text counts as something said.
  const text = textParts(message.content, ["text"]);
  if (!text) return null;
  return { text, role, timestamp: timestampOf(record) };
}

/** Codex rollout line: `{type: "response_item", payload: {type: "message", role, content}}`. */
export function parseCodexLine(value: unknown): SessionTextSearchMessage | null {
  const record = asRecord(value);
  const payload = asRecord(record?.payload);
  if (!record || !payload || record.type !== "response_item" || payload.type !== "message") {
    return null;
  }
  const role = roleOf(payload.role);
  const text = textParts(payload.content, ["input_text", "output_text"]);
  if (!role || !text) return null;
  if (role === "user") {
    const trimmed = text.trimStart();
    if (CODEX_INJECTED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return null;
  }
  return { text, role, timestamp: timestampOf(record) };
}

let sharedReader: PersistedConversationReader | null = null;

/** One reader per daemon process, so the cache is shared by every connected client. */
export function getSharedPersistedConversationReader(): PersistedConversationReader {
  sharedReader ??= new PersistedConversationReader();
  return sharedReader;
}
