import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";

/**
 * A UI command is issued by one client and acted on by the others, so the only
 * way to prove the wiring is to have two clients attached at once.
 */
class ObservedClient {
  readonly messages: SessionOutboundMessage[] = [];
  private readonly unsubscribe: () => void;

  constructor(readonly client: DaemonClient) {
    this.unsubscribe = client.subscribeRawMessages((message) => {
      this.messages.push(message);
    });
  }

  uiCommands(): SessionOutboundMessage[] {
    return this.messages.filter((message) => message.type === "ui.command");
  }

  /** Round-trip a request so anything the daemon already sent has arrived. */
  async barrier(label: string): Promise<void> {
    await this.client.ping({ requestId: `barrier-${label}` });
  }

  close(): void {
    this.unsubscribe();
  }
}

let daemon: TestPaseoDaemon;
let workspaceRoot: string;
const observed: ObservedClient[] = [];

async function connect(clientId: string): Promise<ObservedClient> {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId,
    reconnect: { enabled: false },
  });
  await client.connect();
  const connected = new ObservedClient(client);
  observed.push(connected);
  return connected;
}

beforeEach(async () => {
  daemon = await createTestPaseoDaemon();
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-ui-tab-"));
});

afterEach(async () => {
  for (const connected of observed) {
    connected.close();
    await connected.client.close().catch(() => undefined);
  }
  observed.length = 0;
  await daemon.close();
  await rm(workspaceRoot, { recursive: true, force: true });
}, 30_000);

async function openWorkspace(client: DaemonClient): Promise<string> {
  const opened = await client.openProject(workspaceRoot);
  const workspace = opened.workspace;
  if (!workspace) {
    throw new Error(`Failed to open workspace: ${opened.error ?? "unknown error"}`);
  }
  return workspace.id;
}

test("the daemon advertises uiCommands", async () => {
  const caller = await connect("clid_ui_caller");
  expect(caller.client.supportsUiCommands()).toBe(true);
});

test("a tab open request reaches every other client but not the caller", async () => {
  const caller = await connect("clid_ui_caller");
  const app = await connect("clid_ui_app");
  const workspaceId = await openWorkspace(caller.client);

  const response = await caller.client.openWorkspaceTab({
    workspaceId,
    target: { kind: "terminal", terminalId: "terminal-1" },
  });

  expect(response).toMatchObject({ workspaceId, deliveredTo: 1, error: null });
  expect(response.serverId).not.toBe("");

  await app.barrier("ui-command");
  expect(app.uiCommands()).toEqual([
    {
      type: "ui.command",
      payload: {
        command: "tab.open",
        serverId: response.serverId,
        workspaceId,
        target: { kind: "terminal", terminalId: "terminal-1" },
      },
    },
  ]);
  expect(caller.uiCommands()).toEqual([]);
});

test("focus:false is carried through to the push", async () => {
  const caller = await connect("clid_ui_caller");
  const app = await connect("clid_ui_app");
  const workspaceId = await openWorkspace(caller.client);

  await caller.client.openWorkspaceTab({
    workspaceId,
    target: { kind: "draft" },
    focus: false,
  });

  await app.barrier("ui-command-unfocused");
  expect(app.uiCommands()).toMatchObject([
    { payload: { command: "tab.open", target: { kind: "draft" }, focus: false } },
  ]);
});

test("an unknown workspace is rejected and nothing is broadcast", async () => {
  const caller = await connect("clid_ui_caller");
  const app = await connect("clid_ui_app");

  await expect(
    caller.client.openWorkspaceTab({
      workspaceId: "workspace-does-not-exist",
      target: { kind: "agent", agentId: "agent-1" },
    }),
  ).rejects.toThrow("Workspace not found: workspace-does-not-exist");

  await app.barrier("ui-command-rejected");
  expect(app.uiCommands()).toEqual([]);
});

test("a request with no other client attached succeeds with zero deliveries", async () => {
  const caller = await connect("clid_ui_caller");
  const workspaceId = await openWorkspace(caller.client);

  const response = await caller.client.openWorkspaceTab({
    workspaceId,
    target: { kind: "agent", agentId: "agent-1" },
  });

  expect(response).toMatchObject({ workspaceId, deliveredTo: 0, error: null });
});
