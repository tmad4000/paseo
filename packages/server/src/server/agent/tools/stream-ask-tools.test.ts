import { describe, expect, test } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate, StreamListOptions } from "@getpaseo/protocol/global-stream";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createProviderSnapshotManagerStub } from "../../test-utils/session-stubs.js";
import type { AgentManager } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import { listStreamRows } from "../global-stream.js";
import { applyStreamEntryUpdate } from "../stream-entry-update.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";

const SERVER_ID = "srv_test";

async function createCatalog() {
  const entries = new Map<string, CompanionEntry[]>();
  const agentManager = {
    subscribe: () => () => undefined,
    getAgent: () => null,
    updateCompanionEntry: async (input: StreamEntryUpdate & { agentId: string }) => {
      entries.set(
        input.agentId,
        applyStreamEntryUpdate(entries.get(input.agentId) ?? [], input, SERVER_ID),
      );
    },
    listGlobalStream: async (options: StreamListOptions) =>
      listStreamRows(
        [...entries].map(([id, companionEntries]) => ({
          id,
          title: `Chat ${id}`,
          cwd: "/p",
          companionEntries,
        })),
        options,
        SERVER_ID,
      ),
  } as unknown as AgentManager;
  const catalog = await createPaseoToolCatalog({
    agentManager,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: createProviderSnapshotManagerStub(),
    logger: createTestLogger(),
    callerAgentId: "orchestrator",
  });
  return { catalog, entries };
}

const blockedAsk = {
  askId: "wikihub-merge",
  expectedRevision: 0,
  text: "Merge the Ideaflow ID account",
  ask: {
    state: "blocked",
    remaining:
      "Auto-mode classifier blocks production DB reads/writes. Need Jacob's explicit go-ahead.\nThen merge.",
    evidence: "",
  },
};

describe("Stream ask MCP tools and blocked asks", () => {
  test("descriptions tell agents that blocked asks reach Needs you", async () => {
    const { catalog } = await createCatalog();
    expect(catalog.getTool("set_stream_ask")?.description).toContain(
      "Blocked asks appear in the user's Needs you",
    );
    expect(catalog.getTool("set_stream_question")?.description).toContain("inputRequest.task");
    expect(catalog.getTool("list_stream_asks")?.description).toBeTruthy();
  });

  test("list_stream_asks needsYou returns the blocked ask; compact rows are small", async () => {
    const { catalog } = await createCatalog();
    await catalog.executeTool("set_stream_ask", blockedAsk);
    await catalog.executeTool("set_stream_ask", {
      askId: "other",
      expectedRevision: 0,
      text: "Unrelated work",
      ask: { state: "in_progress", remaining: "Build it", evidence: "" },
    });
    const full = await catalog.executeTool("list_stream_asks", { global: true, needsYou: true });
    const fullRows = (full.structuredContent as { rows: Array<{ askId: string }> }).rows;
    expect(fullRows.map((row) => row.askId)).toEqual(["wikihub-merge"]);

    const compact = await catalog.executeTool("list_stream_asks", {
      global: true,
      needsYou: true,
      compact: true,
    });
    expect((compact.structuredContent as { rows: unknown[] }).rows).toEqual([
      {
        askId: "wikihub-merge",
        entryId: "ask:wikihub-merge",
        agentId: "orchestrator",
        agentTitle: "Chat orchestrator",
        archived: false,
        kind: "question",
        state: "blocked",
        headline: "Merge the Ideaflow ID account",
        next: "Auto-mode classifier blocks production DB reads/writes. Need Jacob's explicit go-ahead.",
        blockedOn: { recipient: "user" },
        revision: 1,
        timestamp: expect.any(String),
      },
    ]);
  });

  test("states filters tasks; a blocker outside the user keeps the ask out of needsYou", async () => {
    const { catalog } = await createCatalog();
    await catalog.executeTool("set_stream_ask", {
      ...blockedAsk,
      blocker: { kind: "action", recipient: "external", recipientId: "YouTube Studio" },
    });
    await catalog.executeTool("set_stream_ask", {
      askId: "other",
      expectedRevision: 0,
      text: "Unrelated work",
      ask: { state: "in_progress", remaining: "Build it", evidence: "" },
    });
    const needsYou = await catalog.executeTool("list_stream_asks", {
      global: true,
      needsYou: true,
    });
    expect((needsYou.structuredContent as { rows: unknown[] }).rows).toEqual([]);
    const blockedOnly = await catalog.executeTool("list_stream_asks", {
      global: true,
      states: ["blocked"],
      compact: true,
    });
    expect(
      (blockedOnly.structuredContent as { rows: Array<{ askId: string; blockedOn: unknown }> })
        .rows,
    ).toEqual([
      expect.objectContaining({
        askId: "wikihub-merge",
        blockedOn: { kind: "action", recipient: "external", recipientId: "YouTube Studio" },
      }),
    ]);
  });
});
