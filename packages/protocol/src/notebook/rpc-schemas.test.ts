import { describe, expect, it } from "vitest";
import { AgentNotebookAppendRequestSchema, AgentNotebookGetResponseSchema } from "./rpc-schemas.js";

describe("work notebook RPC schemas", () => {
  it("accepts a bounded question append request", () => {
    expect(
      AgentNotebookAppendRequestSchema.parse({
        type: "agent.notebook.append.request",
        agentId: "agent-1",
        requestId: "request-1",
        expectedRevision: 0,
        entry: {
          kind: "question_opened",
          markdown: "What still needs a decision?",
        },
      }),
    ).toEqual({
      type: "agent.notebook.append.request",
      agentId: "agent-1",
      requestId: "request-1",
      expectedRevision: 0,
      entry: {
        kind: "question_opened",
        markdown: "What still needs a decision?",
      },
    });
  });

  it("parses a paginated notebook response without changing the event stream", () => {
    const result = AgentNotebookGetResponseSchema.parse({
      type: "agent.notebook.get.response",
      payload: {
        requestId: "request-1",
        result: {
          status: "found",
          notebook: {
            id: "notebook-1",
            agentId: "agent-1",
            scope: "session",
            createdAt: "2026-07-25T00:00:00.000Z",
            updatedAt: "2026-07-25T00:00:00.000Z",
            revision: 1,
            lastSequence: 1,
          },
          events: [
            {
              id: "event-1",
              notebookId: "notebook-1",
              sequence: 1,
              createdAt: "2026-07-25T00:00:00.000Z",
              author: { kind: "user" },
              kind: "note_added",
              markdown: "Keep the stream canonical",
            },
          ],
          hasMore: false,
          writable: true,
          readOnlyReason: null,
        },
      },
    });

    expect(result.payload.result.status).toBe("found");
    if (result.payload.result.status !== "found") {
      throw new Error("Expected found notebook");
    }
    expect(result.payload.result.events.map((event) => event.kind)).toEqual(["note_added"]);
    expect(result.payload.result.writable).toBe(true);
  });

  it("parses deterministic link and artifact observations in the canonical stream", () => {
    const result = AgentNotebookGetResponseSchema.parse({
      type: "agent.notebook.get.response",
      payload: {
        requestId: "request-derived",
        result: {
          status: "found",
          notebook: {
            id: "notebook-1",
            agentId: "agent-1",
            scope: "session",
            createdAt: "2026-07-25T00:00:00.000Z",
            updatedAt: "2026-07-25T00:00:02.000Z",
            revision: 2,
            lastSequence: 2,
          },
          events: [
            {
              id: "derived-link",
              notebookId: "notebook-1",
              sequence: 1,
              createdAt: "2026-07-25T00:00:01.000Z",
              author: { kind: "system" },
              kind: "link_captured",
              url: "https://paseo.sh/",
              source: {
                agentId: "agent-1",
                timelineSequence: 5,
                role: "assistant",
              },
            },
            {
              id: "derived-artifact",
              notebookId: "notebook-1",
              sequence: 2,
              createdAt: "2026-07-25T00:00:02.000Z",
              author: { kind: "system" },
              kind: "artifact_observed",
              artifact: {
                path: "report.md",
                name: "report.md",
                kind: "markdown",
                mimeType: "text/markdown",
                size: 42,
                createdAt: "2026-07-25T00:00:00.000Z",
                updatedAt: "2026-07-25T00:00:02.000Z",
              },
              source: { agentId: "agent-1" },
            },
          ],
          hasMore: false,
          writable: true,
          readOnlyReason: null,
        },
      },
    });

    expect(result.payload.result).toMatchObject({
      status: "found",
      events: [{ kind: "link_captured" }, { kind: "artifact_observed" }],
    });
  });
});
