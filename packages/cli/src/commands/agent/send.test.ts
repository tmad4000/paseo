import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runSendCommand } from "./send.js";

const daemonTarget = { kind: "endpoint" as const, host: "example.test:12345" };
const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";

/** Agents the fake daemon has a record of. */
let daemonAgentIds: string[] = [];
const fetchAgent = vi.fn(async (options: { agentId: string }) =>
  daemonAgentIds.includes(options.agentId) ? { agent: { id: options.agentId } } : null,
);
const sendAgentMessage = vi.fn(async () => ({ queued: true }));
const close = vi.fn(async () => undefined);

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({ fetchAgent, sendAgentMessage, close })),
  getDaemonHost: vi.fn(() => "ws://127.0.0.1:6767"),
}));

describe("runSendCommand", () => {
  const originalCaller = process.env.PASEO_AGENT_ID;

  beforeEach(() => {
    daemonAgentIds = [TARGET_ID];
    fetchAgent.mockClear();
    sendAgentMessage.mockClear();
    delete process.env.PASEO_AGENT_ID;
  });

  afterEach(() => {
    if (originalCaller === undefined) delete process.env.PASEO_AGENT_ID;
    else process.env.PASEO_AGENT_ID = originalCaller;
  });

  async function send(): Promise<void> {
    await runSendCommand(TARGET_ID, "Report", { daemonTarget, wait: false }, {} as never);
  }

  it("names the calling agent when run in an agent's shell on the same daemon", async () => {
    daemonAgentIds = [TARGET_ID, CALLER_ID];
    process.env.PASEO_AGENT_ID = CALLER_ID;

    await send();

    expect(sendAgentMessage).toHaveBeenCalledWith(TARGET_ID, "Report", {
      images: undefined,
      callerAgentId: CALLER_ID,
    });
  });

  it("names no caller outside an agent's shell", async () => {
    await send();

    expect(fetchAgent).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith(TARGET_ID, "Report", { images: undefined });
  });

  it("names no caller when the target daemon does not have the calling agent", async () => {
    process.env.PASEO_AGENT_ID = CALLER_ID;

    await send();

    expect(sendAgentMessage).toHaveBeenCalledWith(TARGET_ID, "Report", { images: undefined });
  });
});
