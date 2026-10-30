import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMIT_RESPONSE_TIMEOUT_MS, runAllowCommand } from "./allow.js";
import { runDenyCommand } from "./deny.js";

const daemonTarget = { kind: "endpoint" as const, host: "ssh://build-box" };
const agentId = "2d85f428-fdaf-4d98-906f-c583de2b805f";

function permissionRequest(id: string): AgentPermissionRequest {
  return { id, provider: "codex", name: "CodexMcpElicitation", kind: "tool" };
}

const writeRequest = permissionRequest("permission-3b5b773f-a45d-4c4e-a0bf-fc2821f82783");
const editRequest = permissionRequest("permission-654ff862-b312-4f6e-8aac-427421ff65eb");

const mocks = vi.hoisted(() => ({
  respondToPermission: vi.fn(),
  respondToPermissionAndWait: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    fetchAgent: vi.fn(async () => ({
      agent: { id: agentId, pendingPermissions: [writeRequest, editRequest] },
    })),
    respondToPermission: mocks.respondToPermission,
    respondToPermissionAndWait: mocks.respondToPermissionAndWait,
    close: mocks.close,
  })),
}));

class FakeRpcError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

beforeEach(() => {
  mocks.respondToPermission.mockReset();
  mocks.respondToPermissionAndWait.mockReset();
  mocks.close.mockReset();
  mocks.close.mockResolvedValue(undefined);
});

describe("permit allow", () => {
  it("waits for the daemon to confirm before reporting allowed", async () => {
    const order: string[] = [];
    mocks.respondToPermissionAndWait.mockImplementation(async () => {
      order.push("confirmed");
      return { agentId, requestId: writeRequest.id, resolution: { behavior: "allow" } };
    });
    mocks.close.mockImplementation(async () => {
      order.push("closed");
    });

    const result = await runAllowCommand(agentId, "permission-3b5b", { daemonTarget }, {} as never);

    expect(result.data).toMatchObject([{ requestId: writeRequest.id, result: "allowed" }]);
    expect(mocks.respondToPermissionAndWait).toHaveBeenCalledWith(
      agentId,
      writeRequest.id,
      { behavior: "allow" },
      PERMIT_RESPONSE_TIMEOUT_MS,
    );
    expect(mocks.respondToPermission).not.toHaveBeenCalled();
    expect(order).toEqual(["confirmed", "closed"]);
  });

  it("fails instead of reporting allowed when the daemon rejects the response", async () => {
    mocks.respondToPermissionAndWait.mockRejectedValue(
      new FakeRpcError(
        "Request failed: No pending permission request with id 'x' requestType=agent_permission_response code=handler_error",
        "handler_error",
      ),
    );

    await expect(
      runAllowCommand(agentId, writeRequest.id, { daemonTarget }, {} as never),
    ).rejects.toMatchObject({
      code: "ALLOW_PERMISSION_FAILED",
      message: expect.stringContaining("No pending permission request"),
    });
    expect(mocks.close).toHaveBeenCalled();
  });

  it("fails with a timeout when the daemon never confirms", async () => {
    mocks.respondToPermissionAndWait.mockRejectedValue(
      new Error(`Timeout waiting for message (${PERMIT_RESPONSE_TIMEOUT_MS}ms)`),
    );

    await expect(
      runAllowCommand(agentId, writeRequest.id, { daemonTarget }, {} as never),
    ).rejects.toMatchObject({ code: "PERMISSION_RESPONSE_TIMEOUT" });
  });
});

describe("permit deny", () => {
  it("waits for confirmation of every denied request", async () => {
    mocks.respondToPermissionAndWait.mockResolvedValue({});

    const result = await runDenyCommand(
      agentId,
      undefined,
      { daemonTarget, all: true, message: "no" },
      {} as never,
    );

    expect(result.data.map((item) => item.result)).toEqual(["denied", "denied"]);
    expect(mocks.respondToPermissionAndWait.mock.calls.map((call) => call[1])).toEqual([
      writeRequest.id,
      editRequest.id,
    ]);
    expect(mocks.respondToPermissionAndWait).toHaveBeenCalledWith(
      agentId,
      writeRequest.id,
      { behavior: "deny", message: "no" },
      PERMIT_RESPONSE_TIMEOUT_MS,
    );
    expect(mocks.respondToPermission).not.toHaveBeenCalled();
  });

  it("surfaces a lost connection as a deny failure", async () => {
    mocks.respondToPermissionAndWait.mockRejectedValue(
      new FakeRpcError("Daemon client closed", "DAEMON_CONNECTION_LOST"),
    );

    await expect(
      runDenyCommand(agentId, writeRequest.id, { daemonTarget }, {} as never),
    ).rejects.toMatchObject({
      code: "DENY_PERMISSION_FAILED",
      message: expect.stringContaining("Daemon client closed"),
    });
  });
});
