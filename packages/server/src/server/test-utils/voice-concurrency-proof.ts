/** Run manually: npx tsx packages/server/src/server/test-utils/voice-concurrency-proof.ts
 * Real Codex execution + synthetic speech events, never microphone/native evidence.
 * All daemon state and the controlled child live under artifacts/astra-review/.
 */
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pino from "pino";
import { createPaseoDaemon } from "../bootstrap.js";
import { DaemonClient } from "./daemon-client.js";
import type { SpeechService, SpeechReadinessState } from "../speech/speech-runtime.js";
import type { StreamingTranscriptionSession } from "../speech/speech-provider.js";
import type { TurnDetectionSession } from "../speech/turn-detection-provider.js";
import type { AgentManagerEvent } from "../agent/agent-manager.js";

class Recognizer extends EventEmitter implements StreamingTranscriptionSession {
  requiredSampleRate = 16000;
  async connect() {}
  appendPcm16() {}
  commit() {}
  clear() {}
  close() {}
}
class Detector extends EventEmitter implements TurnDetectionSession {
  requiredSampleRate = 16000;
  async connect() {}
  appendPcm16() {}
  flush() {}
  reset() {}
  close() {}
}
const fallbackText: string[] = [];
const recognizers: Recognizer[] = [];
const detectors: Detector[] = [];
const ready: SpeechReadinessState = {
  enabled: true,
  available: true,
  reasonCode: "ready",
  message: "Synthetic proof speech",
  retryable: false,
  missingModelIds: [],
};
const stt = {
  id: "local",
  createSession: () => {
    const session = new Recognizer();
    recognizers.push(session);
    return session;
  },
};
const speechService: SpeechService = {
  resolveStt: () => stt,
  resolveDictationStt: () => stt,
  resolveSttLanguage: () => "en",
  resolveDictationSttLanguage: () => "en",
  resolveTts: () => ({
    async synthesizeSpeech(text) {
      fallbackText.push(text);
      return { stream: Readable.from([Buffer.from("synthetic-audio")]), format: "pcm" };
    },
  }),
  resolveTurnDetection: () => ({
    id: "local",
    createSession: () => {
      const session = new Detector();
      detectors.push(session);
      return session;
    },
  }),
  getReadiness: () => ({
    generatedAt: new Date().toISOString(),
    requiredLocalModelIds: [],
    missingLocalModelIds: [],
    download: { inProgress: false, error: null },
    realtimeVoice: ready,
    dictation: ready,
    voiceFeature: ready,
  }),
  onReadinessChange: () => () => {},
  start() {},
  async stop() {},
  ready: Promise.resolve(),
};
async function until<T>(
  fn: () => T | Promise<T>,
  label: string,
  timeout = 120_000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
async function say(text: string, segmentId: string) {
  const detector = detectors.at(-1)!;
  const recognizer = recognizers.at(-1)!;
  detector.emit("speech_started");
  await tick();
  detector.emit("speech_stopped");
  await tick();
  recognizer.emit("committed", { segmentId, previousSegmentId: null });
  recognizer.emit("transcript", { segmentId, transcript: text, isFinal: true });
  await tick();
}
await mkdir("artifacts/astra-review", { recursive: true });
const root = await mkdtemp(path.resolve("artifacts/astra-review/provider-"));
const home = path.join(root, "home");
const cwd = path.join(root, "workspace");
await mkdir(home);
await mkdir(cwd);
await writeFile(
  path.join(cwd, "barrier.cjs"),
  `const fs = require('node:fs');
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', "const fs=require('node:fs'); let n=0; const t=setInterval(()=>{fs.writeFileSync('heartbeat.json',JSON.stringify({pid:process.pid,n:++n})); if(fs.existsSync('release')){clearInterval(t);process.exit(0)}},100)"], {stdio:'inherit'});
fs.writeFileSync('parent.json',JSON.stringify({pid:process.pid,child:child.pid}));
child.on('exit',code=>{console.log('BARRIER_RELEASED');process.exit(code||0)});
setTimeout(()=>{child.kill();process.exit(2)},180000).unref();
`,
);
const daemon = await createPaseoDaemon(
  {
    listen: "127.0.0.1:0",
    paseoHome: home,
    corsAllowedOrigins: [],
    hostnames: true,
    mcpEnabled: false,
    staticDir: cwd,
    mcpDebug: false,
    agentClients: {},
    agentStoragePath: path.join(home, "agents"),
    relayEnabled: false,
    metadataGeneration: { providers: [] },
  },
  pino({ level: "warn" }),
  { speechService },
);
const clients: DaemonClient[] = [];
const events: AgentManagerEvent[] = [];
const result: Record<string, unknown> = { root, syntheticSpeech: true, nativeMicrophone: false };
let unsubscribe = () => {};
try {
  await daemon.start();
  const target = daemon.getListenTarget();
  assert(target?.type === "tcp" && target.port !== 6767);
  result.port = target.port;
  const connect = async (clientId: string) => {
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${target.port}/ws`,
      appVersion: "0.10.0-beta.1",
      clientId,
    });
    clients.push(client);
    client.on("audio_output", (message) => {
      if (
        message.type === "audio_output" &&
        message.payload.attachmentId &&
        message.payload.generation
      )
        void client.audioPlayed(message.payload.id, undefined, {
          attachmentId: message.payload.attachmentId,
          generation: message.payload.generation,
        });
    });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    return client;
  };
  const first = await connect("voice-proof-owner");
  const second = await connect("voice-proof-other");
  const agent = await first.createAgent({ provider: "codex", cwd, modeId: "full-access" });
  result.agentId = agent.id;
  unsubscribe = daemon.agentManager.subscribe(
    (event) => {
      if (event.type === "agent_stream" && event.agentId === agent.id) events.push(event);
    },
    { replayState: false },
  );
  await first.sendMessage(
    agent.id,
    "Run `node barrier.cjs` in this workspace exactly once using your command tool. It intentionally waits for a test controller to create release. Keep waiting/polling that same command until it exits; never stop it or create release yourself. Do not spawn another agent. After it exits, reply BARRIER_DONE.",
    { messageId: "barrier-prompt" },
  );
  const heartbeat = async () =>
    JSON.parse(await readFile(path.join(cwd, "heartbeat.json"), "utf8").catch(() => "null")) as {
      pid: number;
      n: number;
    } | null;
  await until(heartbeat, "real provider's tool child heartbeat");
  const before = daemon.agentManager.getAgent(agent.id)!;
  assert(before.activeForegroundTurnId);
  const sessionId = before.persistence?.sessionId;
  const turnId = before.activeForegroundTurnId;
  const checkpoints: unknown[] = [];
  async function survives(label: string) {
    const a = await heartbeat();
    assert(a);
    const b = await until(async () => {
      const next = await heartbeat();
      return next && next.n > a.n ? next : null;
    }, "next child heartbeat");
    process.kill(b.pid, 0);
    const current = daemon.agentManager.getAgent(agent.id)!;
    assert.equal(current.persistence?.sessionId, sessionId);
    assert.equal(current.activeForegroundTurnId, turnId);
    assert.equal(current.pendingPermissions.size, 0);
    checkpoints.push({ label, child: b.pid, heartbeat: b.n, sessionId, turnId });
  }
  const attachmentId = randomUUID();
  const a = await first.setVoiceMode(true, agent.id, { attachmentId });
  assert(a.generation);
  await survives("attach");
  await say("Reply exactly FOLLOWUP_ONE and do not use tools.", "reused-segment");
  const one = await until(async () => {
    const q = await first.listQueuedAgentMessages(agent.id);
    return q.items.length === 1 ? q : null;
  }, "first speech admission");
  await first.sendMessage(agent.id, "Reply exactly TYPED_TWO and do not use tools.", {
    messageId: "typed-two",
  });
  assert.deepEqual(
    (await second.listQueuedAgentMessages(agent.id)).items.map((x) => x.id),
    [one.items[0].id, "typed-two"],
  );
  await first.setVoiceMode(false, undefined, { attachmentId, generation: a.generation });
  await survives("detach");
  const b = await first.setVoiceMode(true, agent.id, { attachmentId });
  assert(b.generation);
  // Same identity reclaims a live source; late old cleanup must not release the new token.
  const reconnected = await connect("voice-proof-owner");
  const c = await reconnected.setVoiceMode(true, agent.id, { attachmentId });
  assert(c.generation);
  assert.notEqual(c.generation, b.generation);
  await first.close();
  await survives("reconnect and stale source cleanup");
  await assert.rejects(second.setVoiceMode(true, agent.id, { attachmentId }), /another device/);
  await assert.rejects(
    second.readVoiceInputReceipts({ agentId: agent.id, attachmentId, generation: c.generation }),
    /owned/,
  );
  const receipts = await reconnected.readVoiceInputReceipts({
    agentId: agent.id,
    attachmentId,
    generation: c.generation,
  });
  assert.equal(receipts.items[0]?.state, "queued");
  await say("Reply exactly FOLLOWUP_THREE and do not use tools.", "reused-segment");
  const queued = await until(async () => {
    const q = await second.listQueuedAgentMessages(agent.id);
    return q.items.length === 3 ? q : null;
  }, "speech across recognizer generations");
  const expected = queued.items.map((x) => x.id);
  assert.notEqual(expected[0], expected[2]);
  await survives("two speech finals and typed FIFO");
  await writeFile(path.join(cwd, "release"), "release\n");
  await until(
    async () => {
      const q = await reconnected.listQueuedAgentMessages(agent.id);
      return q.items.length === 0 && daemon.agentManager.getAgent(agent.id)?.lifecycle === "idle";
    },
    "all follow-ups submitted and completed",
    180_000,
  );
  const submitted = events.flatMap((e) =>
    e.type === "agent_stream" && e.event.type === "timeline" && e.event.item.type === "user_message"
      ? [e.event.item.clientMessageId]
      : [],
  );
  assert.deepEqual(submitted, ["barrier-prompt", ...expected]);
  assert.equal(daemon.agentManager.getAgent(agent.id)?.persistence?.sessionId, sessionId);
  assert.equal(
    events.filter((e) => e.type === "agent_stream" && e.event.type === "turn_canceled").length,
    0,
  );
  const completedReceipts = await reconnected.readVoiceInputReceipts({
    agentId: agent.id,
    attachmentId,
    generation: c.generation,
  });
  assert.deepEqual(
    completedReceipts.items.map((x) => x.state),
    ["submitted", "submitted"],
  );
  await until(() => fallbackText.includes("FOLLOWUP_THREE"), "visible fallback synthesis");
  assert(fallbackText.includes("FOLLOWUP_ONE"));
  assert(fallbackText.includes("TYPED_TWO"));
  Object.assign(result, {
    fallbackText,
    verdict: "passed",
    sessionId,
    turnId,
    checkpoints,
    expected,
    submitted,
    generations: [a.generation, b.generation, c.generation],
    receipts: completedReceipts.items,
    cancellationEvents: 0,
    permissionBoundary:
      "No real permission request in full-access provider proof; deterministic permission regressions reported separately",
    ownership: "competing client attach and receipt read rejected",
  });
  console.log(JSON.stringify(result));
} catch (error) {
  Object.assign(result, {
    verdict: "failed",
    error: error instanceof Error ? error.stack : String(error),
  });
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await writeFile(path.join(cwd, "release"), "cleanup\n");
  await writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2));
  await writeFile(path.join(root, "events.json"), JSON.stringify(events, null, 2));
  unsubscribe();
  for (const client of clients) await client.close().catch(() => undefined);
  await daemon.stop();
}
