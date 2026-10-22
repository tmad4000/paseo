import {
  AgentMessageRejectedError,
  DaemonConnectionError,
} from "@getpaseo/client/internal/daemon-client";
import { describe, expect, test } from "vitest";

import {
  flushSendOutbox,
  canEditRefusedSend,
  isDefinitiveSendFailure,
  SEND_OUTBOX_MAX_ATTEMPTS,
  supportsDurableDirectSend,
  type PendingDirectSend,
  type SendOutboxAccess,
  type SendOutboxFlushClient,
} from "./model";

function pendingSend(overrides: Partial<PendingDirectSend> = {}): PendingDirectSend {
  return {
    serverId: "server-1",
    agentId: "agent-1",
    clientMessageId: "msg-1",
    text: "hello",
    images: [],
    attachments: [],
    createdAt: 1,
    attempts: 0,
    ...overrides,
  };
}

function createOutbox(initial: PendingDirectSend[]) {
  const entries = new Map(initial.map((entry) => [entry.clientMessageId, entry]));
  const outbox: SendOutboxAccess = {
    list: (serverId) =>
      [...entries.values()]
        .filter((entry) => entry.serverId === serverId)
        .sort((a, b) => a.createdAt - b.createdAt),
    get: (id) => entries.get(id),
    remove: (id) => {
      entries.delete(id);
    },
    bumpAttempts: (id) => {
      const entry = entries.get(id);
      if (entry) entries.set(id, { ...entry, attempts: entry.attempts + 1 });
    },
    markRejected: (id, error) => {
      const entry = entries.get(id);
      if (entry) entries.set(id, { ...entry, rejectedError: error });
    },
  };
  return { entries, outbox };
}

interface SendCall {
  agentId: string;
  text: string;
  options: Record<string, unknown>;
}

function createClient(respond: (call: SendCall) => Promise<{ queued: boolean }>) {
  const calls: SendCall[] = [];
  const client: SendOutboxFlushClient = {
    sendAgentMessage: (agentId, text, options) => {
      const call = { agentId, text, options: { ...options } };
      calls.push(call);
      return respond(call);
    },
  };
  return { calls, client };
}

describe("flushSendOutbox", () => {
  test("resends the identical request so the host can dedupe a retry", async () => {
    const { entries, outbox } = createOutbox([
      pendingSend({
        activeTurnBehavior: "steer_only",
        images: [{ data: "aGk=", mimeType: "image/png" }],
      }),
    ]);
    const { calls, client } = createClient(async () => ({ queued: false }));
    const accepted: string[] = [];

    await flushSendOutbox({
      serverId: "server-1",
      outbox,
      client,
      onAccepted: (entry) => accepted.push(entry.clientMessageId),
    });

    expect(calls).toEqual([
      {
        agentId: "agent-1",
        text: "hello",
        options: {
          messageId: "msg-1",
          activeTurnBehavior: "steer_only",
          images: [{ data: "aGk=", mimeType: "image/png" }],
          attachments: [],
        },
      },
    ]);
    expect(entries.size).toBe(0);
    expect(accepted).toEqual(["msg-1"]);
  });

  test("keeps the entry and stops that agent when the host is unreachable", async () => {
    const { entries, outbox } = createOutbox([
      pendingSend({ clientMessageId: "first", createdAt: 1 }),
      pendingSend({ clientMessageId: "second", createdAt: 2 }),
    ]);
    const { calls, client } = createClient(async () => {
      throw new DaemonConnectionError("Connection lost");
    });

    await flushSendOutbox({ serverId: "server-1", outbox, client });

    expect(calls.map((call) => call.options.messageId)).toEqual(["first"]);
    expect(entries.get("first")?.attempts).toBe(1);
    expect(entries.get("second")?.attempts).toBe(0);
  });

  test("keeps an entry pending when the client is replaced mid-request", async () => {
    const { entries, outbox } = createOutbox([pendingSend()]);
    const { client } = createClient(async () => {
      throw new Error("Daemon client closed");
    });

    await flushSendOutbox({ serverId: "server-1", outbox, client });

    expect(entries.get("msg-1")).toMatchObject({ attempts: 1 });
    expect(entries.get("msg-1")?.rejectedError).toBeUndefined();
  });

  test("an accepted send whose removal cannot be saved is not reported as refused", async () => {
    const { entries, outbox } = createOutbox([pendingSend()]);
    outbox.remove = () => {
      throw new Error("Storage full");
    };
    const { client } = createClient(async () => ({ queued: false }));
    const accepted: string[] = [];

    await flushSendOutbox({
      serverId: "server-1",
      outbox,
      client,
      onAccepted: (entry) => accepted.push(entry.clientMessageId),
    });

    expect(accepted).toEqual(["msg-1"]);
    expect(entries.get("msg-1")?.rejectedError).toBeUndefined();
  });

  test("parks a refused message for the user and continues with later ones", async () => {
    const { entries, outbox } = createOutbox([
      pendingSend({ clientMessageId: "refused", createdAt: 1 }),
      pendingSend({ clientMessageId: "later", createdAt: 2 }),
    ]);
    const { client } = createClient(async (call) => {
      if (call.options.messageId === "refused")
        throw new AgentMessageRejectedError("Agent not found");
      return { queued: true };
    });
    const rejected: string[] = [];

    await flushSendOutbox({
      serverId: "server-1",
      outbox,
      client,
      onRejected: (entry, message) => rejected.push(`${entry.clientMessageId}:${message}`),
    });

    expect(entries.get("refused")?.rejectedError).toBe("Agent not found");
    expect(entries.has("later")).toBe(false);
    expect(rejected).toEqual(["refused:Agent not found"]);
  });

  test("does not resend a refused entry until the user retries it", async () => {
    const { outbox } = createOutbox([pendingSend({ rejectedError: "Agent not found" })]);
    const { calls, client } = createClient(async () => ({ queued: false }));

    await flushSendOutbox({ serverId: "server-1", outbox, client });

    expect(calls).toEqual([]);
  });

  test("limits a flush to one agent when asked", async () => {
    const { entries, outbox } = createOutbox([
      pendingSend({ clientMessageId: "a", agentId: "agent-1" }),
      pendingSend({ clientMessageId: "b", agentId: "agent-2" }),
    ]);
    const { client } = createClient(async () => ({ queued: false }));

    await flushSendOutbox({ serverId: "server-1", agentId: "agent-2", outbox, client });

    expect([...entries.keys()]).toEqual(["a"]);
  });

  test("raises the retry alert exactly once at the threshold", async () => {
    const { outbox } = createOutbox([pendingSend({ attempts: SEND_OUTBOX_MAX_ATTEMPTS - 1 })]);
    const { client } = createClient(async () => {
      throw new DaemonConnectionError("Timeout waiting for message", "DAEMON_REQUEST_TIMEOUT");
    });
    const alerts: string[] = [];
    const flush = () =>
      flushSendOutbox({
        serverId: "server-1",
        outbox,
        client,
        onRetryLimit: (entry) => alerts.push(entry.clientMessageId),
      });

    await flush();
    await flush();

    expect(alerts).toEqual(["msg-1"]);
  });
});

describe("isDefinitiveSendFailure", () => {
  test("treats only a host answer or an unbuildable request as final", () => {
    expect(isDefinitiveSendFailure(new AgentMessageRejectedError("Agent not found"))).toBe(true);
    expect(isDefinitiveSendFailure(Object.assign(new Error("x"), { name: "DaemonRpcError" }))).toBe(
      true,
    );
  });

  test("treats connection loss, timeouts and a replaced client as unknown delivery", () => {
    expect(isDefinitiveSendFailure(new DaemonConnectionError("lost"))).toBe(false);
    expect(
      isDefinitiveSendFailure(new DaemonConnectionError("slow", "DAEMON_REQUEST_TIMEOUT")),
    ).toBe(false);
    // Review finding: HostRuntime replacing its client rejects waiters with a plain Error.
    expect(isDefinitiveSendFailure(new Error("Daemon client closed"))).toBe(false);
    expect(isDefinitiveSendFailure(new Error("WebSocket not open (readyState=3)"))).toBe(false);
  });
});

describe("canEditRefusedSend", () => {
  test("moves only plain-text messages the host definitely refused", () => {
    const refused = { rejectedError: "Agent not found", images: [], attachments: [] };
    expect(canEditRefusedSend(refused)).toBe(true);
    expect(canEditRefusedSend({ ...refused, rejectedError: undefined })).toBe(false);
    expect(canEditRefusedSend({ ...refused, rejectedError: "agent_request_outcome_unknown" })).toBe(
      false,
    );
    expect(
      canEditRefusedSend({ ...refused, images: [{ data: "aGk=", mimeType: "image/png" }] }),
    ).toBe(false);
  });
});

describe("supportsDurableDirectSend", () => {
  test("requires both dedupe paths", () => {
    expect(supportsDurableDirectSend({ agentRequestReceipts: true, agentMessageQueue: true })).toBe(
      true,
    );
    expect(supportsDurableDirectSend({ agentMessageQueue: true })).toBe(false);
    expect(supportsDurableDirectSend(undefined)).toBe(false);
  });
});
