import { describe, expect, it } from "vitest";
import { ArtifactPinOperations } from "./artifact-pin-operations";
import { MessagePinOperations, messagePinErrorMessage } from "./message-pin-operations";

describe("message pin operations", () => {
  it("shows the actionable server error without request diagnostics", () => {
    const error = Object.assign(
      new Error("Disk full requestType=stream.entry.update.request code=handler_error"),
      { requestType: "stream.entry.update.request", code: "handler_error" },
    );
    expect(messagePinErrorMessage(error, "Could not save")).toBe("Disk full");
    expect(messagePinErrorMessage(new Error("Offline"), "Could not save")).toBe("Offline");
    expect(messagePinErrorMessage(null, "Could not save")).toBe("Could not save");
  });
  it("retries a lost acknowledgement without duplicating a persisted excerpt", async () => {
    const operations = new MessagePinOperations();
    const stored = new Map<string, { text: string; sourceId?: string }>();
    const ids: string[] = [];
    const write = async (input: { entryId: string; text: string; sourceId?: string }) => {
      ids.push(input.entryId);
      stored.set(input.entryId, { text: input.text, sourceId: input.sourceId });
      if (ids.length === 1) throw new Error("Acknowledgement lost");
    };
    await expect(
      operations.save("host", "agent", "Keep this line", "msg:one", write),
    ).rejects.toThrow("Acknowledgement lost");
    await operations.save("host", "agent", "Keep this line", "msg:one", write);
    expect(ids[0]).toBe(ids[1]);
    expect([...stored.values()]).toEqual([{ text: "Keep this line", sourceId: "msg:one" }]);
  });

  it("coalesces repeated clicks and isolates different sources and hosts", async () => {
    const operations = new MessagePinOperations();
    let acknowledge!: () => void;
    const acknowledgement = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const inputs: Array<{ entryId: string; sourceId?: string }> = [];
    const write = async (input: { entryId: string; sourceId?: string }) => {
      inputs.push(input);
      await acknowledgement;
    };
    const first = operations.save("host", "agent", "Same text", "msg:one", write);
    const duplicate = operations.save("host", "agent", "Same text", "msg:one", write);
    const other = operations.save("host", "agent", "Same text", "msg:two", write);
    const otherHost = operations.save("other", "agent", "Same text", "msg:one", write);
    await Promise.resolve();
    expect(inputs).toHaveLength(3);
    expect(new Set(inputs.map((input) => input.entryId)).size).toBe(3);
    expect(first).toBe(duplicate);
    acknowledge();
    await Promise.all([first, duplicate, other, otherHost]);
  });
});

describe("artifact pin operations", () => {
  it("retries a rejected durable write with the same ID and starts fresh after success", async () => {
    const operations = new ArtifactPinOperations();
    const durable = new Map<string, string>();
    const ids: string[] = [];
    const write = async (input: { entryId: string; sourceId: string }) => {
      ids.push(input.entryId);
      durable.set(input.entryId, input.sourceId);
      if (ids.length === 1) throw new Error("Persistence failed");
    };
    await expect(operations.save("host", "agent", "report.md", write)).rejects.toThrow(
      "Persistence failed",
    );
    await operations.save("host", "agent", "report.md", write);
    expect(ids[1]).toBe(ids[0]);
    expect([...durable.values()]).toEqual(["artifact:report.md"]);
    await operations.save("host", "agent", "report.md", write);
    expect(ids[2]).not.toBe(ids[0]);
    expect(durable.size).toBe(2);
  });

  it("isolates failed retries by host, conversation and path", async () => {
    const operations = new ArtifactPinOperations();
    const ids: string[] = [];
    const write = async (input: { entryId: string }) => {
      ids.push(input.entryId);
      throw new Error("Offline");
    };
    for (const [host, agent, path] of [
      ["host", "agent", "one.md"],
      ["other", "agent", "one.md"],
      ["host", "other", "one.md"],
      ["host", "agent", "two.md"],
      ["host", "agent", "one.md"],
    ]) {
      await expect(operations.save(host, agent, path, write)).rejects.toThrow("Offline");
    }
    expect(new Set(ids.slice(0, 4)).size).toBe(4);
    expect(ids[4]).toBe(ids[0]);
  });

  it("coalesces concurrent clicks until acknowledgement", async () => {
    const operations = new ArtifactPinOperations();
    let acknowledge!: () => void;
    const acknowledgement = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    let writes = 0;
    const write = async () => {
      writes++;
      await acknowledgement;
    };
    const first = operations.save("host", "agent", "report.md", write);
    const second = operations.save("host", "agent", "report.md", write);
    await Promise.resolve();
    expect(writes).toBe(1);
    acknowledge();
    await Promise.all([first, second]);
  });
});
