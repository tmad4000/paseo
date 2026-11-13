import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

describe("GenericACPAgentClient slash commands", () => {
  test.each(["commands-after-session-new", "commands-with-foreign-session"] as const)(
    "lists only its own commands when updates arrive with session/new (%s)",
    async (mode) => {
      await withFakeACPAgent(mode, async (command, cwd) => {
        const client = new GenericACPAgentClient({
          logger: createTestLogger(),
          command,
          initialCommandsWaitTimeoutMs: 100,
        });
        const session = await client.createSession({ provider: "acp", cwd });
        try {
          await expect(session.listCommands?.()).resolves.toEqual([
            { name: "review", description: "Review the diff", argumentHint: "", kind: "command" },
          ]);
        } finally {
          await session.close();
        }
      });
    },
  );

  test("answers with no commands for an agent that never advertises any", async () => {
    await withFakeACPAgent("silent", async (command, cwd) => {
      const client = new GenericACPAgentClient({
        logger: createTestLogger(),
        command,
        initialCommandsWaitTimeoutMs: 50,
      });
      const session = await client.createSession({ provider: "acp", cwd });
      try {
        await expect(session.listCommands?.()).resolves.toEqual([]);
      } finally {
        await session.close();
      }
    });
  });
});

async function withFakeACPAgent(
  mode: "commands-after-session-new" | "commands-with-foreign-session" | "silent",
  run: (command: [string, ...string[]], cwd: string) => Promise<void>,
): Promise<void> {
  const testDir = await mkdtemp(path.join(tmpdir(), "paseo-acp-commands-"));
  try {
    const scriptPath = path.join(testDir, "fake-acp-agent.cjs");
    await writeFile(scriptPath, fakeACPAgentScript, "utf8");
    await run([process.execPath, scriptPath, mode], testDir);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}

const fakeACPAgentScript = `
const readline = require("node:readline");

const mode = process.argv[2];
const rl = readline.createInterface({ input: process.stdin });

function write(...messages) {
  process.stdout.write(messages.map((message) => JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n").join(""));
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    write({
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? 1,
        agentCapabilities: { sessionCapabilities: { close: {} } },
      },
    });
    return;
  }

  if (message.method === "session/new") {
    const response = { id: message.id, result: { sessionId: "session-1" } };
    if (mode !== "silent") {
      // One pipe write forces the update to arrive with the response, even on
      // an idle host; a timer leaves the response/update race to OS scheduling.
      const update = {
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "review", description: "Review the diff" }],
            },
          },
      };
      const foreignUpdate = {
        ...update,
        params: {
          sessionId: "another-session",
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [{ name: "unrelated", description: "Another session's command" }],
          },
        },
      };
      write(response, update, ...(mode === "commands-with-foreign-session" ? [foreignUpdate] : []));
    } else {
      write(response);
    }
    return;
  }

  if (message.id !== undefined) {
    write({ id: message.id, result: {} });
  }
});
`;
