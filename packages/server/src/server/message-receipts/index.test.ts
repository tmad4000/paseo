import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { MessageReceipts } from "./index.js";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { STEER_REJECTED_MESSAGE, steerRejectedError } from "../agent/prompt-not-submitted.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-requests-"));
  directories.push(directory);
  return { directory, requests: new MessageReceipts(directory) };
}

test("message retries survive reconstruction without submitting twice", async () => {
  const { requests, directory } = await fixture();
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "arrival",
    request: { text: "hello" },
    send: async () => {
      deliveries++;
    },
  };
  await Promise.all([requests.send(input), requests.send(input)]);
  await new MessageReceipts(directory).send(input);
  expect(deliveries).toBe(1);
  await requests.send({ ...input, agentId: "another" });
  expect(deliveries).toBe(2);
});

test("ambiguous provider delivery is never blindly replayed after restart", async () => {
  const { requests, directory } = await fixture();
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "arrival",
    request: {},
    send: async () => {
      deliveries++;
      throw new Error("connection lost");
    },
  };
  await expect(requests.send(input)).rejects.toThrow("connection lost");
  await expect(new MessageReceipts(directory).send(input)).rejects.toThrow(
    "agent_request_outcome_unknown",
  );
  expect(deliveries).toBe(1);
});

test("failed local message preparation does not leave an ambiguous receipt", async () => {
  const { requests, directory } = await fixture();
  let available = false;
  let sends = 0;
  const input = {
    agentId: "agent",
    messageId: "message",
    request: {},
    prepare: async () => {
      if (!available) throw new Error("load failed");
    },
    send: async () => {
      sends++;
    },
  };
  await expect(requests.send(input)).rejects.toThrow("load failed");
  available = true;
  await new MessageReceipts(directory).send(input);
  available = false;
  await requests.send(input);
  expect(sends).toBe(1);
});

test("voice receipts remain readable after more than 100 later deliveries", async () => {
  const { requests, directory } = await fixture();
  const input = {
    agentId: "agent",
    messageId: "attachment:first",
    attachmentId: "attachment",
    request: { text: "first" },
    send: async () => {},
  };
  await requests.send(input);
  for (let index = 0; index < 101; index++) {
    await requests.send({
      ...input,
      messageId: `attachment:${index}`,
      request: { text: `${index}` },
    });
  }
  const reopened = new MessageReceipts(directory);
  expect(await reopened.get("agent", "attachment:first", input.request)).toBe("completed");
  const outcomes = await reopened.listForAttachment({
    agentId: "agent",
    attachmentId: "attachment",
  });
  expect(outcomes).toHaveLength(102);
  expect(outcomes.map((item) => item.messageId)).toContain("attachment:first");
  await expect(reopened.get("agent", "attachment:first", { text: "changed" })).rejects.toThrow(
    "agent_request_key_conflict",
  );
});

test("known reservation loss clears the pending receipt but provider ambiguity does not", async () => {
  const { requests, directory } = await fixture();
  const busy = Object.assign(new Error("busy"), { code: "AGENT_RUN_BUSY" });
  const input = {
    agentId: "agent",
    messageId: "retryable",
    request: { text: "follow up" },
    send: async () => {
      throw busy;
    },
  };
  await expect(requests.send(input)).rejects.toBe(busy);
  expect(await new MessageReceipts(directory).get("agent", "retryable")).toBe("absent");
  await requests.send({ ...input, send: async () => {} });
  expect(await requests.get("agent", "retryable")).toBe("completed");
});

test("attachment receipts retain client authority across owner reconstruction", async () => {
  const { requests, directory } = await fixture();
  await requests.send({
    agentId: "agent",
    messageId: "attachment:one",
    attachmentId: "attachment",
    voiceOwner: "principal/client-a",
    request: {},
    send: async () => {},
  });
  const reopened = new MessageReceipts(directory);
  expect(
    await reopened.listForAttachment({
      agentId: "agent",
      attachmentId: "attachment",
      voiceOwner: "principal/client-b",
    }),
  ).toEqual([]);
  expect(
    await reopened.listForAttachment({
      agentId: "agent",
      attachmentId: "attachment",
      voiceOwner: "principal/client-a",
    }),
  ).toHaveLength(1);
});

test("pre-dispatch preparation failure stays retryable, active dispatch is not unknown", async () => {
  const { requests } = await fixture();
  const input = {
    agentId: "agent",
    messageId: "attachment:one",
    attachmentId: "attachment",
    request: {},
  };
  await expect(
    requests.send({
      ...input,
      send: async () => {
        throw Object.assign(new Error("load failed"), { code: "AGENT_PROMPT_NOT_SUBMITTED" });
      },
    }),
  ).rejects.toThrow("load failed");
  expect(await requests.get(input.agentId, input.messageId)).toBe("absent");
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = requests.send({
    ...input,
    send: async () => {
      entered();
      await barrier;
    },
  });
  await started;
  expect((await requests.listForAttachment(input))[0].state).toBe("sending");
  release();
  await pending;
  expect((await requests.listForAttachment(input))[0].state).toBe("completed");
});

async function strandPending(directory: string, requests: MessageReceipts) {
  const input = {
    agentId: "agent",
    messageId: "stuck",
    request: { text: "hello" },
    send: async () => {
      throw new Error("connection lost after dispatch");
    },
  };
  await expect(requests.send(input)).rejects.toThrow();
  expect(await new MessageReceipts(directory).get("agent", "stuck")).toBe("pending");
  return input;
}

test("settling a stale pending receipt as absent lets the message send again", async () => {
  const { requests, directory } = await fixture();
  const input = await strandPending(directory, requests);
  const restarted = new MessageReceipts(directory);
  expect(await restarted.settleStalePending("agent", "stuck", "absent")).toBe(true);
  expect(await restarted.get("agent", "stuck")).toBe("absent");
  let deliveries = 0;
  await restarted.send({ ...input, send: async () => void deliveries++ });
  expect(deliveries).toBe(1);
  expect(await restarted.get("agent", "stuck")).toBe("completed");
});

test("settling a stale pending receipt as completed never sends it again", async () => {
  const { requests, directory } = await fixture();
  const input = await strandPending(directory, requests);
  const restarted = new MessageReceipts(directory);
  expect(await restarted.settleStalePending("agent", "stuck", "completed")).toBe(true);
  let deliveries = 0;
  await restarted.send({ ...input, send: async () => void deliveries++ });
  expect(deliveries).toBe(0);
});

test("settling refuses receipts that are not pending or still in flight", async () => {
  const { requests } = await fixture();
  expect(await requests.settleStalePending("agent", "missing", "absent")).toBe(false);
  let release: () => void = () => undefined;
  const sending = requests.send({
    agentId: "agent",
    messageId: "live",
    request: { text: "x" },
    send: () => new Promise<void>((resolve) => (release = resolve)),
  });
  await expect.poll(() => requests.get("agent", "live")).toBe("pending");
  expect(await requests.settleStalePending("agent", "live", "absent")).toBe(false);
  release();
  await sending;
  expect(await requests.settleStalePending("agent", "live", "absent")).toBe(false);
  expect(await requests.get("agent", "live")).toBe("completed");
});

test("a refused strict steer clears its receipt and the same message id can be retried", async () => {
  const { requests, directory } = await fixture();
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "steer",
    request: { text: "while you work" },
    send: async () => {
      throw steerRejectedError();
    },
  };
  await expect(requests.send(input)).rejects.toThrow(STEER_REJECTED_MESSAGE);
  expect(await new MessageReceipts(directory).get("agent", "steer")).toBe("absent");
  await expect(requests.send(input)).rejects.toThrow(STEER_REJECTED_MESSAGE);
  await new MessageReceipts(directory).send({
    ...input,
    send: async () => {
      deliveries++;
    },
  });
  expect(deliveries).toBe(1);
  expect(await requests.get("agent", "steer")).toBe("completed");
});

test("a steer refused because the turn changed is also retryable", async () => {
  const { requests } = await fixture();
  const input = { agentId: "agent", messageId: "raced", request: {} };
  await expect(
    requests.send({
      ...input,
      send: async () => {
        throw steerRejectedError("Active turn changed before steering could be delivered");
      },
    }),
  ).rejects.toThrow("Active turn changed");
  expect(await requests.get(input.agentId, input.messageId)).toBe("absent");
});

test.each([
  "Provider submission outcome unknown: the active turn changed during steering",
  "Provider submission outcome unknown: run start timed out",
  "Requested mock steer transport failure",
])("the first ambiguous response is normalized and survives restart: %s", async (detail) => {
  const { requests, directory } = await fixture();
  const failure = new Error(detail);
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "maybe",
    request: {},
    send: async () => {
      deliveries++;
      throw failure;
    },
  };
  await expect(requests.send(input)).rejects.toMatchObject({
    message: `agent_request_outcome_unknown: ${detail}`,
    cause: failure,
  });
  const reopened = new MessageReceipts(directory);
  expect(await reopened.get("agent", "maybe")).toBe("pending");
  await expect(reopened.send(input)).rejects.toThrow("agent_request_outcome_unknown");
  expect(deliveries).toBe(1);
  expect(await reopened.settleStalePending("agent", "maybe", "absent")).toBe(true);
  await reopened.send({
    ...input,
    send: async () => {
      deliveries++;
    },
  });
  expect(deliveries).toBe(2);
  expect(await reopened.get("agent", "maybe")).toBe("completed");
});

test("a completion receipt write failure reports ambiguity without replay after restart", async () => {
  const { directory } = await fixture();
  const failure = new Error("completion receipt disk full");
  const requests = new MessageReceipts(directory, async (file, receipt) => {
    if (receipt.state === "completed") throw failure;
    await writeJsonFileAtomic(file, receipt);
  });
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "write-failed",
    request: { text: "arrived" },
    send: async () => {
      deliveries++;
    },
  };
  await expect(requests.send(input)).rejects.toMatchObject({
    message: "agent_request_outcome_unknown: completion receipt disk full",
    cause: failure,
  });
  const reopened = new MessageReceipts(directory);
  expect(await reopened.get(input.agentId, input.messageId)).toBe("pending");
  await expect(reopened.send(input)).rejects.toThrow("agent_request_outcome_unknown");
  expect(deliveries).toBe(1);
});

test("a pending receipt write failure remains a known failure before provider dispatch", async () => {
  const { directory } = await fixture();
  const failure = new Error("pending receipt unavailable");
  const requests = new MessageReceipts(directory, async () => {
    throw failure;
  });
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "not-dispatched",
    request: {},
    send: async () => {
      deliveries++;
    },
  };
  await expect(requests.send(input)).rejects.toBe(failure);
  expect(deliveries).toBe(0);
  expect(await new MessageReceipts(directory).get(input.agentId, input.messageId)).toBe("absent");
});

test("only the process that dispatched a pending receipt reports owning it", async () => {
  const { requests, directory } = await fixture();
  const input = {
    agentId: "agent",
    messageId: "owned",
    request: {},
    send: async () => {
      throw new Error("connection lost");
    },
  };
  expect(requests.dispatchedByThisProcess("agent", "owned")).toBe(false);
  await expect(requests.send(input)).rejects.toThrow("connection lost");
  expect(requests.dispatchedByThisProcess("agent", "owned")).toBe(true);
  expect(new MessageReceipts(directory).dispatchedByThisProcess("agent", "owned")).toBe(false);
  expect(await requests.settleStalePending("agent", "owned", "absent")).toBe(true);
  expect(requests.dispatchedByThisProcess("agent", "owned")).toBe(false);
});
