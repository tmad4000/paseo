import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { MessageReceipts } from "./index.js";

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
  await expect(requests.send(input)).rejects.toThrow("busy");
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
