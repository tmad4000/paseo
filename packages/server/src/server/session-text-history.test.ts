import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { claudeProjectDirSync } from "./agent/providers/claude/project-dir.js";
import {
  PersistedConversationReader,
  parseClaudeLine,
  parseCodexLine,
} from "./session-text-history.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "paseo-text-history-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function claudeFixture(cwd: string, sessionId: string, records: unknown[]) {
  const configDir = join(root, "claude");
  const dir = claudeProjectDirSync(cwd, { configDir });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, jsonl(records));
  return { configDir, path };
}

test("reads an unloaded Claude agent's typed messages from its transcript", async () => {
  const cwd = join(root, "workspace");
  mkdirSync(cwd);
  const { configDir } = claudeFixture(cwd, "claude-session", [
    { type: "attachment", attachment: { content: "hook output" } },
    {
      type: "user",
      timestamp: "2026-10-01T10:00:00Z",
      message: { role: "user", content: [{ type: "text", text: "Why does the relay reconnect?" }] },
    },
    {
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", content: "relay log" }] },
    },
    {
      type: "assistant",
      timestamp: "2026-10-01T10:01:00Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "relay internals" },
          { type: "text", text: "The heartbeat timer drops." },
        ],
      },
    },
    { type: "user", isSidechain: true, message: { role: "user", content: "subagent relay" } },
    { type: "user", isMeta: true, message: { role: "user", content: "meta relay" } },
  ]);
  const reader = new PersistedConversationReader({ claudeConfigDir: () => configDir });
  const messages = await reader.read({
    agentId: "a1",
    provider: "claude",
    cwd,
    persistence: { provider: "claude", sessionId: "claude-session" },
    activityStamp: "t1",
  });
  expect(messages).toEqual([
    { text: "Why does the relay reconnect?", role: "user", timestamp: "2026-10-01T10:00:00Z" },
    { text: "The heartbeat timer drops.", role: "assistant", timestamp: "2026-10-01T10:01:00Z" },
  ]);
});

test("finds Codex rollouts by thread id in dated and archived folders, skipping injected context", async () => {
  const home = join(root, "codex");
  const dated = join(home, "sessions", "2026", "10", "05");
  mkdirSync(dated, { recursive: true });
  mkdirSync(join(home, "archived_sessions"), { recursive: true });
  const live = "01a10dfb-0f32-7003-8052-2892606b13dd";
  const archived = "01a06151-3240-7bd2-9345-de0d01ac9164";
  const message = (role: string, type: string, text: string) => ({
    timestamp: "2026-10-05T21:32:01Z",
    type: "response_item",
    payload: { type: "message", role, content: [{ type, text }] },
  });
  writeFileSync(
    join(dated, `rollout-2026-10-05T15-31-59-${live}.jsonl`),
    jsonl([
      { type: "session_meta", payload: { session_id: live } },
      message("developer", "input_text", "voice instructions"),
      message("user", "input_text", "# AGENTS.md instructions for /repo"),
      message("user", "input_text", "<environment_context>\n</environment_context>"),
      message("user", "input_text", "Embed tweets in the feed"),
      message("assistant", "output_text", "Tweets now embed."),
      { type: "event_msg", payload: { type: "token_count" } },
    ]),
  );
  writeFileSync(
    join(home, "archived_sessions", `rollout-2026-09-02T02-51-46-${archived}.jsonl`),
    jsonl([message("user", "input_text", "Card rendering for approvals")]),
  );
  const reader = new PersistedConversationReader({ codexHome: () => home });
  const source = (agentId: string, sessionId: string) => ({
    agentId,
    provider: "codex",
    cwd: "/repo",
    persistence: { provider: "codex", sessionId },
    activityStamp: "t1",
  });
  expect((await reader.read(source("live", live))).map((item) => item.text)).toEqual([
    "Embed tweets in the feed",
    "Tweets now embed.",
  ]);
  expect((await reader.read(source("old", archived))).map((item) => item.text)).toEqual([
    "Card rendering for approvals",
  ]);
  expect(await reader.read(source("other", "unknown-thread"))).toEqual([]);
  expect(
    await reader.read({ ...source("gemini", live), provider: "gemini", persistence: { sessionId: live } }),
  ).toEqual([]);
});

test("caches per activity stamp, re-reads when it changes, and reads only the tail", async () => {
  const cwd = join(root, "workspace");
  mkdirSync(cwd);
  const say = (text: string) => ({ type: "user", message: { role: "user", content: text } });
  const { configDir, path } = claudeFixture(cwd, "s", [say("first relay note")]);
  const reader = new PersistedConversationReader({
    claudeConfigDir: () => configDir,
    maxBytes: 200,
  });
  const source = {
    agentId: "a",
    provider: "claude",
    cwd,
    persistence: { sessionId: "s" },
    activityStamp: "t1",
  };
  expect((await reader.read(source)).map((item) => item.text)).toEqual(["first relay note"]);
  appendFileSync(path, jsonl([say("second relay note")]));
  expect((await reader.read(source)).map((item) => item.text)).toEqual(["first relay note"]);
  appendFileSync(path, jsonl(Array.from({ length: 10 }, (_, index) => say(`later ${index}`))));
  const tail = await reader.read({ ...source, activityStamp: "t2" });
  expect(tail.at(-1)?.text).toBe("later 9");
  expect(tail.some((item) => item.text === "first relay note")).toBe(false);
});

test("evicts the oldest cached transcripts past the character budget", async () => {
  const cwd = join(root, "workspace");
  mkdirSync(cwd);
  const say = (text: string) => ({ type: "user", message: { role: "user", content: text } });
  const a = claudeFixture(cwd, "a", [say("x".repeat(60))]);
  claudeFixture(cwd, "b", [say("y".repeat(60))]);
  const reader = new PersistedConversationReader({
    claudeConfigDir: () => a.configDir,
    maxCachedChars: 100,
  });
  const source = (id: string) => ({
    agentId: id,
    provider: "claude",
    cwd,
    persistence: { sessionId: id },
    activityStamp: "t1",
  });
  await reader.read(source("a"));
  await reader.read(source("b"));
  rmSync(a.path);
  // "a" was evicted, so its now-missing file reads as empty; "b" is still cached.
  expect(await reader.read(source("a"))).toEqual([]);
  expect((await reader.read(source("b")))[0]?.text).toBe("y".repeat(60));
});

test("line parsers ignore malformed and non-message records", () => {
  expect(parseClaudeLine(null)).toBeNull();
  expect(parseClaudeLine({ type: "summary", summary: "relay" })).toBeNull();
  expect(parseCodexLine({ type: "response_item", payload: { type: "reasoning" } })).toBeNull();
  expect(parseCodexLine({ type: "event_msg", payload: { type: "message" } })).toBeNull();
});
