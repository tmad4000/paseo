import { writeFile, readFile, rm, rename } from "node:fs/promises";
import path from "node:path";
import { copyPluginExample } from "./helpers/plugin-fixture";
import { connectNewWorkspaceDaemonClient } from "./helpers/new-workspace";
import { test as base } from "./fixtures";
import {
  createCreationScenario,
  createPromptRetryScenario,
  retryNextAgentCreation,
} from "./helpers/creation";
import { installDaemonWebSocketGate } from "./helpers/daemon-websocket-gate";
import { delayBrowserAgentCreatedStatus } from "./helpers/new-workspace";

export const test = base.extend<{
  startup: { release(): Promise<void>; fail(): Promise<void> };
  creation: Awaited<ReturnType<typeof createCreationScenario>>;
  promptRetry: ReturnType<typeof createPromptRetryScenario>;
  agentRetries: Awaited<ReturnType<typeof retryNextAgentCreation>>;
  delayedCreation: Awaited<ReturnType<typeof delayBrowserAgentCreatedStatus>>;
}>({
  startup: async ({ page }, provide, testInfo) => {
    const wireEvents: Record<string, unknown>[] = [];
    const summarize = (value: unknown, depth = 0): unknown => {
      if (depth > 4 || !value || typeof value !== "object") return undefined;
      if (Array.isArray(value)) return value.slice(0, 20).map((item) => summarize(item, depth + 1));
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (
          [
            "id",
            "agentId",
            "workspaceId",
            "requestId",
            "status",
            "error",
            "code",
            "archivedAt",
            "internal",
            "provider",
            "modeId",
            "reason",
          ].includes(key)
        ) {
          if (typeof item === "string") result[key] = item.slice(0, 500);
          else if (typeof item === "boolean" || item === null) result[key] = item;
        } else if (
          [
            "payload",
            "agent",
            "workspace",
            "config",
            "snapshot",
            "agents",
            "workspaces",
            "removed",
            "updates",
          ].includes(key)
        ) {
          result[key] = summarize(item, depth + 1);
        }
      }
      return result;
    };
    page.on("websocket", (socket) => {
      const observe = (direction: string, payload: string | Buffer) => {
        try {
          const envelope = JSON.parse(payload.toString());
          const message = envelope.type === "session" ? envelope.message : null;
          if (!message || !/agent|workspace|status/.test(message.type) || wireEvents.length >= 512)
            return;
          wireEvents.push({
            at: Date.now(),
            direction,
            type: message.type,
            fields: summarize(message),
          });
        } catch {
          // Binary and unrelated transport frames carry no creation identity.
        }
      };
      socket.on("framesent", ({ payload }) => observe("sent", payload));
      socket.on("framereceived", ({ payload }) => observe("received", payload));
    });
    const client = await connectNewWorkspaceDaemonClient();
    const plugin = await copyPluginExample("lifecycle-logger");
    const gate = path.join(plugin.directory, "startup.txt");
    const failure = path.join(plugin.directory, "startup-failure.txt");
    const events = path.join(plugin.directory, "startup-events.jsonl");
    const previous = await client.getDaemonConfig();
    const failures: unknown[] = [];
    try {
      await writeFile(gate, "hold");
      await writeFile(failure, "fail");
      await writeFile(
        path.join(plugin.directory, "index.server.ts"),
        `
import { appendFile, readFile, rm } from "node:fs/promises";
export default function contribute(server) {
  return server.before("agent.session_open", async ({ request }) => {
    if (request.reason !== "create") return request;
    const gate = ${JSON.stringify(gate)};
    const record = (phase, command) => appendFile(${JSON.stringify(events)}, JSON.stringify({
      at: Date.now(), phase, command, agentId: request.agentId,
      workspaceId: request.workspaceId, provider: request.provider, purpose: request.purpose,
    }) + "\\n");
    let command = await readFile(gate, "utf8").catch(() => "release");
    await record("entered", command);
    while (command === "hold") {
      await new Promise(resolve => setTimeout(resolve, 20));
      command = await readFile(gate, "utf8").catch(() => "release");
    }
    await record("observed", command);
    if (command === "fail") {
      await rm(gate, { force: true });
      await record("failure-consumed", command);
      throw new Error("Creation startup failed for test");
    }
    return request;
  });
}
`,
      );
      await client.patchDaemonConfig({ pluginsEnabled: true });
      await client.installDirectoryPlugin(plugin.directory);
      await provide({
        release: () => rm(gate, { force: true }),
        // Replacing the command must not expose a truncated, empty file to the hook.
        fail: () => rename(failure, gate),
      });
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        // Capture before cleanup releases any still-waiting session hook.
        const recorded = await readFile(events, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        });
        const evidence = testInfo.outputPath("startup-hook-events.jsonl");
        await writeFile(evidence, recorded);
        await testInfo.attach("startup-hook-events", {
          path: evidence,
          contentType: "application/x-ndjson",
        });
        const wireEvidence = testInfo.outputPath("startup-wire-events.json");
        await writeFile(
          wireEvidence,
          JSON.stringify({ events: wireEvents, capped: wireEvents.length >= 512 }, null, 2),
        );
        await testInfo.attach("startup-wire-events", {
          path: wireEvidence,
          contentType: "application/json",
        });
      } catch (error) {
        failures.push(error);
      }
      for (const cleanup of [
        () => rm(gate, { force: true }),
        () => client.removePlugin("lifecycle-logger"),
        () => client.patchDaemonConfig({ pluginsEnabled: previous.config.pluginsEnabled }),
        () => plugin.cleanup(),
        () => client.close(),
      ]) {
        try {
          await cleanup();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length) throw new AggregateError(failures, "Startup fixture or cleanup failed");
  },
  creation: async ({ page }, provide) => {
    const creation = await createCreationScenario(page);
    try {
      await provide(creation);
    } finally {
      await creation.cleanup();
    }
  },
  promptRetry: async ({ page }, provide) => {
    const gate = await installDaemonWebSocketGate(page);
    try {
      await provide(createPromptRetryScenario(page, gate));
    } finally {
      gate.restore();
    }
  },
  agentRetries: async ({ page }, provide) => {
    await provide(await retryNextAgentCreation(page));
  },
  delayedCreation: async ({ page }, provide) => {
    const delayed = await delayBrowserAgentCreatedStatus(page);
    try {
      await provide(delayed);
    } finally {
      delayed.release();
    }
  },
});
