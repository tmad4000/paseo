import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_REDACTION, type ShareSnapshot } from "@getpaseo/protocol/sharing";
import { openShareForm } from "./share-form-model";
import { hostFeatureAvailability } from "@/runtime/host-features";
const snapshot: ShareSnapshot = {
  v: 1,
  title: "Preview",
  owner: { name: "Jacob" },
  agent: { provider: "codex" },
  createdAt: "2026-10-24T12:00:00Z",
  messages: [
    { kind: "assistant", id: "m1", at: "2026-10-24T12:00:00Z", text: "exact redacted preview" },
  ],
  redactionSummary: {
    hiddenToolCalls: 1,
    hiddenReasoning: 0,
    secretsMasked: 0,
    pathsCollapsed: 0,
    contactsMasked: 0,
    messagesExcluded: 0,
  },
  sourceDigest: "digest",
};
const createClient = () => ({
  previewShareLink: vi.fn<DaemonClient["previewShareLink"]>(async () => snapshot),
  createShareLink: vi.fn<DaemonClient["createShareLink"]>(async () => ({
    share: {} as never,
    url: "https://share.example/s/token",
  })),
});
describe("share preview form", () => {
  it("hides hosts by default and sends an explicit host toggle through preview and create", async () => {
    const client = createClient();
    const model = openShareForm(client, "agent");
    await model.start();
    expect(model.getState().profile.scrub.hosts).toBe(true);
    model.setScrub("hosts", false);
    await vi.waitFor(() => expect(model.getState().preview.status).toBe("loaded"));
    expect(client.previewShareLink).toHaveBeenLastCalledWith("agent", {
      ...DEFAULT_REDACTION,
      scrub: { ...DEFAULT_REDACTION.scrub, hosts: false },
    });
    await model.create();
    expect(client.createShareLink.mock.calls[0]![0].redaction?.scrub.hosts).toBe(false);
    model.close();
  });
  it("keeps the server preview verbatim and creates with default redaction, seven-day expiry and preview digest", async () => {
    const client = createClient();
    const model = openShareForm(client, "agent");
    await model.start();
    expect(model.getState().preview).toEqual({ status: "loaded", snapshot });
    const before = Date.now();
    expect(await model.create()).toBe("https://share.example/s/token");
    expect(client.createShareLink).toHaveBeenCalledWith({
      agentId: "agent",
      redaction: DEFAULT_REDACTION,
      expiresAt: expect.any(String),
      previewDigest: "digest",
    });
    const expires = client.createShareLink.mock.calls[0]![0].expiresAt;
    expect(Date.parse(expires!) - before).toBeGreaterThanOrEqual(7 * 86400000);
    model.close();
  });
  it("reruns preview for toggles and rejects stale responses", async () => {
    let complete!: (value: ShareSnapshot) => void;
    const client = createClient();
    client.previewShareLink.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const model = openShareForm(client, "agent");
    const pending = model.start();
    model.setInclude("toolCalls", true);
    await vi.waitFor(() => expect(model.getState().preview.status).toBe("loaded"));
    complete({ ...snapshot, title: "stale" });
    await pending;
    expect(model.getState().preview).toMatchObject({
      status: "loaded",
      snapshot: { title: "Preview" },
    });
    expect(client.previewShareLink).toHaveBeenLastCalledWith("agent", {
      ...DEFAULT_REDACTION,
      include: { ...DEFAULT_REDACTION.include, toolCalls: true },
    });
    model.close();
  });
  it("keeps the create-once URL and blocks duplicate pending creates", async () => {
    let complete!: (value: { share: never; url: string }) => void;
    const client = createClient();
    client.createShareLink.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const model = openShareForm(client, "agent");
    await model.start();
    const pending = model.create();
    expect(await model.create()).toBeNull();
    complete({ share: {} as never, url: "https://share.example/s/new" });
    await pending;
    expect(model.getState().url).toBe("https://share.example/s/new");
    model.close();
  });
  it("distinguishes an older host from a not-yet-connected host at the gate", () => {
    expect(hostFeatureAvailability(undefined, "conversationSharing")).toBeNull();
    expect(hostFeatureAvailability({ features: {} } as never, "conversationSharing")).toBe(false);
    expect(
      hostFeatureAvailability(
        { features: { conversationSharing: true } } as never,
        "conversationSharing",
      ),
    ).toBe(true);
  });
});
