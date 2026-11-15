import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pino from "pino";
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
