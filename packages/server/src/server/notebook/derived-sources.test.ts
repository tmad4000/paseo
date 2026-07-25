import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { deriveNotebookSources } from "./derived-sources.js";

const artifact = (overrides: Partial<AgentArtifact> = {}): AgentArtifact => ({
  path: "reports/summary.md",
  name: "summary.md",
  kind: "markdown",
  mimeType: "text/markdown",
  size: 42,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:01.000Z",
  ...overrides,
});

describe("deriveNotebookSources", () => {
  it("captures normalized links from user and completed assistant message chunks", () => {
    const sources = deriveNotebookSources({
      agentId: "agent-1",
      timelineRows: [
        {
          seq: 1,
          timestamp: "2026-07-25T00:00:00.000Z",
          item: {
            type: "user_message",
            text: "Use https://example.com/docs.",
            messageId: "user-1",
          },
        },
        {
          seq: 2,
          timestamp: "2026-07-25T00:00:01.000Z",
          item: {
            type: "assistant_message",
            text: "Result: https://paseo.",
            messageId: "assistant-1",
          },
        },
        {
          seq: 3,
          timestamp: "2026-07-25T00:00:02.000Z",
          item: {
            type: "assistant_message",
            text: "sh/guide?q=1",
            messageId: "assistant-1",
          },
        },
      ],
      artifacts: [],
    });

    expect(sources.links).toEqual([
      {
        url: "https://example.com/docs",
        source: {
          agentId: "agent-1",
          timelineSequence: 1,
          messageId: "user-1",
          role: "user",
        },
      },
      {
        url: "https://paseo.sh/guide?q=1",
        source: {
          agentId: "agent-1",
          timelineSequence: 2,
          messageId: "assistant-1",
          role: "assistant",
        },
      },
    ]);
  });

  it("deduplicates links and orders artifact observations deterministically", () => {
    const sources = deriveNotebookSources({
      agentId: "agent-1",
      timelineRows: [
        {
          seq: 2,
          timestamp: "2026-07-25T00:00:02.000Z",
          item: { type: "assistant_message", text: "https://example.com" },
        },
        {
          seq: 3,
          timestamp: "2026-07-25T00:00:03.000Z",
          item: { type: "user_message", text: "Again https://example.com/" },
        },
      ],
      artifacts: [
        artifact({ path: "z.md", name: "z.md", updatedAt: "2026-07-25T00:00:02.000Z" }),
        artifact({ path: "a.md", name: "a.md", updatedAt: "2026-07-25T00:00:01.000Z" }),
      ],
    });

    expect(sources.links).toHaveLength(1);
    expect(sources.artifacts.map((item) => item.path)).toEqual(["a.md", "z.md"]);
  });
});
