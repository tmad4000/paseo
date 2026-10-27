import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCli } from "../cli.js";
import { DEFAULT_REDACTION } from "@getpaseo/protocol/sharing";
import { parseShareExpiry, parseShareRedaction } from "./share.js";
const client = vi.hoisted(() => ({
  getLastServerInfoMessage: vi.fn(() => ({ features: { conversationSharing: true } })),
  fetchAgents: vi.fn(async () => ({ entries: [{ agent: { id: "agent-123", title: "Example" } }] })),
  createShareLink: vi.fn<DaemonClient["createShareLink"]>(async () => ({
    share: { id: "shr_example" } as never,
    url: "https://share.example/s/one-time-token",
  })),
  listShareLinks: vi.fn(async () => [{ id: "shr_example", title: "Example", revokedAt: null }]),
  revokeShareLink: vi.fn(async () => ({ id: "shr_example", revokedAt: "2026-10-24T12:00:00Z" })),
  deleteShareLink: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));
vi.mock("../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => client),
  resolveAgentId: (input: string) => (input.startsWith("agent") ? "agent-123" : null),
}));
beforeEach(() => {
  vi.clearAllMocks();
});
describe("share CLI", () => {
  it("prints a create URL once, lists token-free records as JSON, and revokes", async () => {
    const writes: string[] = [];
    const output = vi.spyOn(process.stdout, "write").mockImplementation((value) => {
      writes.push(String(value));
      return true;
    });
    try {
      await createCli().parseAsync(["share", "create", "agent", "--expires", "7d"], {
        from: "user",
      });
      expect(writes.join("").match(/https:\/\/share.example\/s\/one-time-token/g)).toHaveLength(1);
      expect(client.createShareLink).toHaveBeenCalledWith({
        agentId: "agent-123",
        title: undefined,
        redaction: DEFAULT_REDACTION,
        expiresAt: expect.any(String),
      });
      writes.length = 0;
      await createCli().parseAsync(["share", "ls", "--json"], { from: "user" });
      expect(writes.join("")).toContain("shr_example");
      expect(writes.join("")).not.toMatch(/token|tokenHash/);
      await createCli().parseAsync(["share", "revoke", "shr_example"], { from: "user" });
      expect(client.revokeShareLink).toHaveBeenCalledWith("shr_example");
    } finally {
      output.mockRestore();
    }
  });
  it.each(["paths", "hosts"] as const)("honors --no-scrub %s", async (key) => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await createCli().parseAsync(["share", "create", "agent", "--no-scrub", key], {
        from: "user",
      });
      expect(client.createShareLink.mock.calls[0]![0].redaction.scrub[key]).toBe(false);
    } finally {
      output.mockRestore();
    }
  });
  it("validates expiry and redaction selections", () => {
    expect(parseShareExpiry("never")).toBeNull();
    expect(parseShareExpiry("24h", 0)).toBe("1970-01-02T00:00:00.000Z");
    expect(() => parseShareExpiry("forever")).toThrow();
    expect(() => parseShareRedaction("output")).toThrow();
    expect(() => parseShareRedaction("", "unknown")).toThrow();
  });
});
