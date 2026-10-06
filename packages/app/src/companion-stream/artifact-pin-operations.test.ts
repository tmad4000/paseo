import { describe, expect, it } from "vitest";
import { ArtifactPinOperations } from "./artifact-pin-operations";

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
