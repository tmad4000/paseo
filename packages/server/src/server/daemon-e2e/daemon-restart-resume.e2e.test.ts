import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withTimeout } from "../../utils/promise-timeout.js";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  startDaemonInstance,
  stopDaemonInstance,
  readDaemonInstance,
  type DaemonInstance,
} from "../daemon-instance.js";
import pino from "pino";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { CodexAppServerAgentClient } from "../agent/providers/codex-app-server-agent.js";
import { createDesktopSettingsStore } from "../../../../desktop/src/settings/desktop-settings.js";
import { stopDesktopManagedDaemonOnQuitIfNeeded } from "../../../../desktop/src/daemon/quit-lifecycle.js";
import type { PersistenceHandle } from "@getpaseo/protocol/messages";

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-restart-resume-"));
}

describe("daemon restart resume", () => {
  let ctx: DaemonTestContext;

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  }, 60_000);

  test("Codex agent survives daemon restart with persistence handle", async () => {
    const cwd = tmpCwd();
    const marker = `DAEMON_RESTART_MARKER_${Date.now()}`;
    try {
      const agent = await ctx.client.createAgent({
        provider: "codex",
        cwd,
        title: "Daemon Restart Test Agent",
        modeId: "full-access",
      });

      await ctx.client.sendMessage(
        agent.id,
        `Remember this marker string for a test: "${marker}".`,
      );

      const afterRemember = await ctx.client.waitForFinish(agent.id, 5_000);
      expect(afterRemember.status).toBe("idle");
      expect(afterRemember.final?.persistence).toBeTruthy();
      expect(afterRemember.final!.persistence!.metadata).toMatchObject({ marker });

      const handle = afterRemember.final!.persistence as PersistenceHandle;

      await ctx.cleanup();
      ctx = await createDaemonTestContext();

      const resumed = await ctx.client.resumeAgent(handle);
      await ctx.client.sendMessage(
        resumed.id,
        "What was the marker string I asked you to remember earlier?",
      );

      const afterRecall = await ctx.client.waitForFinish(resumed.id, 5_000);
      expect(afterRecall.status).toBe("idle");
      expect(afterRecall.final?.persistence).toBeTruthy();
      expect(afterRecall.final!.persistence!.metadata).toMatchObject({ marker });

      await ctx.client.deleteAgent(resumed.id);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});

// Opt in explicitly: this makes a real provider request, in task-owned state only.
test.runIf(process.env.PASEO_APP_RESTART_QA === "1")(
  "a live Codex tool turn completes across desktop quit and settings/client recreation",
  async () => {
    const root = tmpCwd();
    const release = path.join(root, "tool-release");
    const logger = pino({ level: "silent" });
    const provider = new CodexAppServerAgentClient(logger, {
      env: {
        HOME: root,
        // Use the established provider authentication location; never copy credentials.
        CODEX_HOME: process.env.CODEX_HOME ?? path.join(homedir(), ".codex"),
      },
    });
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      agentClients: { codex: provider },
      logger,
    });
    const url = `ws://127.0.0.1:${daemon.port}/ws`;
    let client = new DaemonClient({ url, appVersion: "0.10.0-beta.30" });
    let finished = false;
    try {
      const store = createDesktopSettingsStore({ userDataPath: path.join(root, "desktop") });
      await store.patch({ daemon: { preserveAgentsOnAppRestart: true } });
      await client.connect();
      const agent = await client.createAgent({
        provider: "codex",
        cwd: root,
        modeId: "full-access",
      });
      const marker = path.join(root, "tool-started");
      await client.sendMessage(
        agent.id,
        `Run this exact shell command in one foreground tool call: touch '${marker}'; timeout 180 sh -c 'until test -f "${release}"; do sleep 1; done' && echo RESTART_TURN_COMPLETE. Then reply RESTART_TURN_COMPLETE. Do not background it.`,
      );
      await expect.poll(() => existsSync(marker), { timeout: 120_000 }).toBe(true);
      const before = daemon.daemon.agentManager.getAgent(agent.id)!;
      expect(before.lifecycle).toBe("running");
      const sessionId = before.persistence?.sessionId;
      const runtime = before.session;
      expect(typeof sessionId).toBe("string");
      const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
        settingsStore: store,
        isDesktopManagedDaemonRunning: () => true,
        stopDaemon: () => daemon.daemon.stop(),
        showShutdownFeedback: () => {
          throw new Error("Unexpected daemon shutdown");
        },
      });
      expect(stopped).toBe(false);
      expect(daemon.daemon.agentManager.getAgent(agent.id)?.session).toBe(runtime);
      await client.close();
      // Exercise the same quit policy in separate desktop-owner processes. Neither
      // owns the daemon's SDK pipes, so exiting one cannot interrupt its tool turn.
      const ownerSource = `
        import settingsModule from ${JSON.stringify(new URL("../../../../desktop/src/settings/desktop-settings.ts", import.meta.url).href)};
        import quitModule from ${JSON.stringify(new URL("../../../../desktop/src/daemon/quit-lifecycle.ts", import.meta.url).href)};
        const { createDesktopSettingsStore } = settingsModule;
        const { stopDesktopManagedDaemonOnQuitIfNeeded } = quitModule;
        const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
          settingsStore: createDesktopSettingsStore({userDataPath: process.argv[1]}),
          isDesktopManagedDaemonRunning: () => true,
          stopDaemon: async () => { throw new Error("Must preserve live daemon"); },
          showShutdownFeedback: () => { throw new Error("Must preserve live daemon"); },
        });
        process.stdout.write(JSON.stringify({stopped, pid: process.pid}));
      `;
      const ownerPids: number[] = [];
      for (let i = 0; i < 2; i++) {
        const result = await promisify(execFile)(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", ownerSource, path.join(root, "desktop")],
          { cwd: process.cwd(), env: { ...process.env, HOME: root, PASEO_HOME: daemon.paseoHome } },
        );
        const owner = JSON.parse(result.stdout) as { stopped: boolean; pid: number };
        expect(owner.stopped).toBe(false);
        ownerPids.push(owner.pid);
      }
      expect(new Set(ownerPids).size).toBe(2);
      // A fresh desktop settings owner and connection attach to the same daemon.
      expect(
        (await createDesktopSettingsStore({ userDataPath: path.join(root, "desktop") }).get())
          .daemon.preserveAgentsOnAppRestart,
      ).toBe(true);
      client = new DaemonClient({ url, appVersion: "0.10.0-beta.30" });
      await client.connect();
      expect(daemon.daemon.agentManager.getAgent(agent.id)?.lifecycle).toBe("running");
      writeFileSync(release, "release");
      const after = await client.waitForFinish(agent.id, 120_000);
      expect(after.status).toBe("idle");
      expect(after.lastMessage).toContain("RESTART_TURN_COMPLETE");
      expect(after.final?.persistence?.sessionId).toBe(sessionId);
      finished = true;
    } finally {
      writeFileSync(release, "release");
      await client.close();
      // Only this isolated test daemon is closed, after its turn finishes normally.
      if (!finished) {
        const running = daemon.daemon.agentManager
          .listAgents()
          .filter((a) => a.lifecycle === "running");
        for (const agent of running) {
          const observer = new DaemonClient({ url, appVersion: "0.10.0-beta.30" });
          await observer.connect();
          await observer.waitForFinish(agent.id, 180_000);
          await observer.close();
        }
      }
      await daemon.close();
    }
  },
  300_000,
);

// Unlike the desktop-owner test above, this replaces an actual supervised worker.
test.runIf(process.env.PASEO_DAEMON_RESTART_QA === "1" && process.platform === "linux")(
  "graceful daemon restart waits for real Codex and restores its resident session in a new worker",
  async () => {
    const root = tmpCwd();
    const home = path.join(root, "daemon");
    const release = path.join(root, "release-turn");
    const started = path.join(root, "turn-started");
    const completed = path.join(root, "tool-completed");
    const phase = (text: string) => writeFileSync(path.join(root, "qa-phase"), text);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("PASEO_")),
    );
    let captured: DaemonInstance | undefined;
    let client: DaemonClient | undefined;
    let agentId: string | undefined;
    let finished = false;
    try {
      const launch = await startDaemonInstance({
        home,
        command: process.execPath,
        args: [
          fileURLToPath(new URL("../../../dist/scripts/supervisor-entrypoint.js", import.meta.url)),
        ],
        mode: "deployment",
        timeoutMs: 120_000,
        onAcquired: (instance) => {
          captured = instance;
        },
        env: {
          ...env,
          HOME: root,
          USERPROFILE: root,
          CODEX_HOME: process.env.CODEX_HOME ?? path.join(homedir(), ".codex"),
          PASEO_HOME: home,
          PASEO_LISTEN: "127.0.0.1:0",
          PASEO_RELAY_ENABLED: "false",
          PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
          PASEO_DICTATION_ENABLED: "0",
          PASEO_VOICE_MODE_ENABLED: "0",
          PASEO_WEB_UI_ENABLED: "false",
          PASEO_GRACEFUL_RESTART: "1",
        },
      });
      captured = launch.instance;
      client = new DaemonClient({
        url: `ws://${launch.instance.listen}/ws`,
        appVersion: "0.10.0-beta.30",
      });
      await client.connect();
      phase("connected to initial worker");
      const oldPid = (await client.getDaemonStatus()).pid;
      const agent = await client.createAgent({
        provider: "codex",
        cwd: root,
        modeId: "full-access",
      });
      agentId = agent.id;
      await client.sendMessage(
        agent.id,
        `Run this shell command and wait for it to finish before replying: touch '${started}'; timeout 180 sh -c 'until test -f "${release}"; do sleep 1; done' && touch '${completed}' && echo DAEMON_DRAIN_TOOL_FINISHED. Then reply DAEMON_DRAIN_TOOL_FINISHED. Do not background the command.`,
      );
      await expect.poll(() => existsSync(started), { timeout: 120_000 }).toBe(true);
      const before = await client.fetchAgent(agent.id);
      expect(before?.agent.status).toBe("running");
      const sessionId = before?.agent.persistence?.sessionId;
      expect(typeof sessionId).toBe("string");
      let acknowledged = false;
      const restarting = client
        .restartServer("graceful_restart_qa", undefined, { timeout: 180_000 })
        .then((result) => {
          acknowledged = true;
          return result;
        });
      await expect
        .poll(
          () => {
            try {
              return readFileSync(path.join(home, "daemon.log"), "utf8").includes(
                "Waiting for agent turns before daemon restart",
              );
            } catch {
              return false;
            }
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      expect((await client.getDaemonStatus()).pid).toBe(oldPid);
      expect(acknowledged).toBe(false);
      expect(existsSync(completed)).toBe(false);
      writeFileSync(release, "finish normally");
      phase("awaiting restart acknowledgement");
      expect(
        (await withTimeout(restarting, 30_000, "Restart acknowledgement did not settle")).status,
      ).toBe("restart_requested");
      phase("turn completed and restart acknowledged");
      expect(existsSync(completed)).toBe(true);
      await withTimeout(client.close(), 5_000, "Old client teardown did not settle");
      phase("old client closed");
      client = undefined;
      let replacement: DaemonClient | undefined;
      await expect
        .poll(
          async () => {
            phase("probing replacement lock");
            const current = await readDaemonInstance(home);
            if (!current?.listen) return false;
            const candidate = new DaemonClient({
              url: `ws://${current.listen}/ws`,
              appVersion: "0.10.0-beta.30",
              connectTimeoutMs: 1_000,
              reconnect: { enabled: false },
            });
            try {
              phase("connecting replacement client");
              await candidate.connect();
              if ((await candidate.getDaemonStatus({ timeout: 10_000 })).pid === oldPid) {
                await withTimeout(candidate.close(), 5_000, "Probe teardown did not settle");
                return false;
              }
              replacement = candidate;
              return true;
            } catch {
              await withTimeout(candidate.close(), 5_000, "Probe teardown did not settle");
              return false;
            }
          },
          { timeout: 120_000 },
        )
        .toBe(true);
      client = replacement!;
      phase("connected to replacement worker");
      expect((await readDaemonInstance(home))?.pid).toBe(captured.pid);
      const directory = await client.fetchAgents();
      const restored = directory.entries.find((entry) => entry.agent.id === agent.id)?.agent;
      expect(restored?.status).toBe("idle");
      expect(restored?.persistence?.sessionId).toBe(sessionId);
      const after = await client.waitForFinish(agent.id, 30_000);
      expect(after.status).toBe("idle");
      expect(after.lastMessage).toContain("DAEMON_DRAIN_TOOL_FINISHED");
      expect(existsSync(path.join(home, "restart-sessions.json"))).toBe(false);
      finished = true;
      phase("resident session and transcript verified");
    } finally {
      writeFileSync(release, "finish normally");
      await withTimeout(
        client?.close() ?? Promise.resolve(),
        5_000,
        "Test client teardown did not settle",
      ).catch((error) => console.warn("Test client teardown failed", error.message));
      if (!finished && agentId) {
        const instance = await readDaemonInstance(home);
        if (instance?.listen) {
          const observer = new DaemonClient({
            url: `ws://${instance.listen}/ws`,
            appVersion: "0.10.0-beta.30",
          });
          try {
            await observer.connect();
            await observer.waitForFinish(agentId, 180_000);
          } finally {
            await withTimeout(observer.close(), 5_000, "Observer teardown did not settle").catch(
              (error) => console.warn("Observer teardown failed", error.message),
            );
          }
        }
      }
      if (captured) await stopDaemonInstance(home, { instance: captured, timeoutMs: 15_000 });
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
  420_000,
);

test("graceful restart checkpoint restores resident identities without replaying a turn", async () => {
  const root = tmpCwd();
  const staticDir = path.join(root, "static");
  await mkdir(staticDir);
  const prompts: unknown[] = [];
  const clients = () =>
    createTestAgentClients({
      onStartTurn: (prompt) => {
        prompts.push(prompt);
      },
    });
  let daemon = await createTestPaseoDaemon({
    agentClients: clients(),
    paseoHomeRoot: root,
    staticDir,
    cleanup: false,
    gracefulRestart: true,
  });
  let client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.10.0-beta.30",
  });
  try {
    await client.connect();
    const agent = await client.createAgent({ provider: "codex", cwd: root });
    await client.sendMessage(agent.id, "Remember marker DRAIN_CHECKPOINT_TEST");
    const before = await client.waitForFinish(agent.id, 5_000);
    expect(before.status).toBe("idle");
    await client.restartServer("test_checkpoint");
    expect(existsSync(path.join(daemon.paseoHome, "restart-sessions.json"))).toBe(true);
    await client.close();
    await daemon.close();
    daemon = await createTestPaseoDaemon({
      agentClients: clients(),
      paseoHomeRoot: root,
      staticDir,
      cleanup: false,
      gracefulRestart: true,
    });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.10.0-beta.30",
    });
    await client.connect();
    const listed = await client.fetchAgents();
    const restored = listed.entries.find((entry) => entry.agent.id === agent.id)?.agent;
    expect(restored?.status).toBe("idle");
    expect(restored?.persistence?.sessionId).toBe(before.final?.persistence?.sessionId);
    expect(prompts).toEqual(["Remember marker DRAIN_CHECKPOINT_TEST"]);
    const after = await client.waitForFinish(agent.id, 5_000);
    expect(after.lastMessage).toBe(before.lastMessage);
    expect(existsSync(path.join(daemon.paseoHome, "restart-sessions.json"))).toBe(false);
    await client.restartServer("test_queued_restart");
    await client.enqueueAgentMessage({
      agentId: agent.id,
      itemId: "after-restart",
      text: "continue after restart",
    });
    expect(prompts).toEqual(["Remember marker DRAIN_CHECKPOINT_TEST"]);
    await client.close();
    await daemon.close();
    daemon = await createTestPaseoDaemon({
      agentClients: clients(),
      paseoHomeRoot: root,
      staticDir,
      cleanup: false,
      gracefulRestart: true,
    });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.10.0-beta.30",
    });
    await client.connect();
    await expect.poll(() => prompts.length).toBe(2);
    expect((await client.waitForFinish(agent.id, 5_000)).status).toBe("idle");
    expect(prompts).toEqual(["Remember marker DRAIN_CHECKPOINT_TEST", "continue after restart"]);
    expect((await client.listQueuedAgentMessages(agent.id)).items).toEqual([]);
  } finally {
    await client.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("graceful restart reports a failed provider restore without blocking other residents", async () => {
  const root = tmpCwd();
  const staticDir = path.join(root, "static");
  await mkdir(staticDir);
  let daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    staticDir,
    cleanup: false,
    gracefulRestart: true,
  });
  let client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.10.0-beta.30",
  });
  try {
    await client.connect();
    const first = await client.createAgent({ provider: "codex", cwd: root });
    const second = await client.createAgent({ provider: "codex", cwd: root });
    await client.restartServer("test_partial_restore");
    await client.close();
    await daemon.close();
    const clients = createTestAgentClients();
    const codex = clients.codex!;
    const resume = codex.resumeSession.bind(codex);
    codex.resumeSession = async (handle, overrides, context) => {
      if (handle.sessionId === first.persistence?.sessionId)
        throw new Error("provider failed at restart");
      return resume(handle, overrides, context);
    };
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      staticDir,
      cleanup: false,
      gracefulRestart: true,
      agentClients: clients,
    });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.10.0-beta.30",
    });
    await client.connect();
    const listed = await client.fetchAgents();
    const failed = listed.entries.find((entry) => entry.agent.id === first.id)?.agent;
    expect(failed?.status).toBe("error");
    expect(failed?.lastError).toBe(
      "Could not restore after daemon restart: provider failed at restart",
    );
    expect(failed?.attentionReason).toBe("error");
    expect(listed.entries.find((entry) => entry.agent.id === second.id)?.agent.status).toBe("idle");
    expect(
      JSON.parse(readFileSync(path.join(daemon.paseoHome, "restart-sessions.json"), "utf8")),
    ).toEqual({ version: 1, agentIds: [first.id] });
  } finally {
    await client.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}, 20_000);
