import type { AgentNotebookPage, DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { describe, expect, it, vi } from "vitest";
import { CompleteNotebookReadError, readCompleteNotebook } from "./read-complete-notebook";

function page(
  sequences: number[],
  options: {
    revision?: number;
    lastSequence?: number;
    hasMore?: boolean;
    writable?: boolean;
  } = {},
): AgentNotebookPage {
  const revision = options.revision ?? options.lastSequence ?? sequences.at(-1) ?? 0;
  const lastSequence = options.lastSequence ?? sequences.at(-1) ?? 0;
  return {
    notebook: {
      id: "notebook-agent-1",
      agentId: "agent-1",
      scope: "session",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      revision,
      lastSequence,
    },
    events: sequences.map((sequence) => ({
      id: `event-${sequence}`,
      notebookId: "notebook-agent-1",
      agentId: "agent-1",
      sequence,
      kind: "note_added" as const,
      markdown: `Note ${sequence}`,
      author: { kind: "user" as const },
      createdAt: "2026-07-25T00:00:00.000Z",
    })),
    hasMore: options.hasMore ?? false,
    writable: options.writable ?? true,
    readOnlyReason: options.writable === false ? "agent_archived" : null,
  };
}

function clientReturning(...pages: AgentNotebookPage[]) {
  return {
    getAgentNotebook: vi.fn().mockImplementation(async () => {
      const next = pages.shift();
      if (!next) {
        throw new Error("Unexpected page request");
      }
      return next;
    }),
  } as Pick<DaemonClient, "getAgentNotebook">;
}

describe("readCompleteNotebook", () => {
  it("returns a complete, consistently revised stream across pages", async () => {
    const client = clientReturning(
      page([1, 2], { revision: 3, lastSequence: 3, hasMore: true }),
      page([3], { revision: 3, lastSequence: 3 }),
    );

    const result = await readCompleteNotebook(client, "agent-1", { pageSize: 2 });

    expect(result.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(result.hasMore).toBe(false);
    expect(client.getAgentNotebook).toHaveBeenNthCalledWith(2, {
      agentId: "agent-1",
      afterSequence: 2,
      limit: 2,
    });
  });

  it("rejects a stream that does not advance", async () => {
    await expect(
      readCompleteNotebook(
        clientReturning(page([], { lastSequence: 1, hasMore: true })),
        "agent-1",
      ),
    ).rejects.toEqual(new CompleteNotebookReadError("no_progress"));
  });

  it("rejects an incomplete prefix at the page safety limit", async () => {
    await expect(
      readCompleteNotebook(
        clientReturning(page([1], { revision: 2, lastSequence: 2, hasMore: true })),
        "agent-1",
        { maxPages: 1 },
      ),
    ).rejects.toEqual(new CompleteNotebookReadError("page_limit"));
  });

  it("rejects revisions that change during a paginated read", async () => {
    await expect(
      readCompleteNotebook(
        clientReturning(
          page([1], { revision: 2, lastSequence: 2, hasMore: true }),
          page([2], { revision: 3, lastSequence: 2 }),
        ),
        "agent-1",
      ),
    ).rejects.toEqual(new CompleteNotebookReadError("inconsistent_revision"));
  });

  it("rejects write access that changes during a paginated read", async () => {
    await expect(
      readCompleteNotebook(
        clientReturning(
          page([1], { revision: 2, lastSequence: 2, hasMore: true }),
          page([2], { revision: 2, lastSequence: 2, writable: false }),
        ),
        "agent-1",
      ),
    ).rejects.toEqual(new CompleteNotebookReadError("inconsistent_revision"));
  });
});
