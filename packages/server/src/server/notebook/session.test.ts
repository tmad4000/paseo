import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionOutboundMessage } from "../messages.js";
import { afterEach, describe, expect, it } from "vitest";
import { WorkNotebookSession, type WorkNotebookSessionHost } from "./session.js";
import { WorkNotebookStore } from "./store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createSession(
  state: "active" | "archived" | "missing",
  derivedSources: Awaited<ReturnType<WorkNotebookSessionHost["getDerivedSources"]>> = null,
) {
  const directory = await mkdtemp(join(tmpdir(), "paseo-work-notebook-session-"));
  directories.push(directory);
  const emitted: SessionOutboundMessage[] = [];
  const host: WorkNotebookSessionHost = {
    emit: (message) => emitted.push(message),
    getAgentState: async () => state,
    getDerivedSources: async () => derivedSources,
  };
  return {
    emitted,
    session: new WorkNotebookSession(host, new WorkNotebookStore(directory)),
  };
}

describe("WorkNotebookSession", () => {
  it("echoes request correlation and exposes active notebooks as writable", async () => {
    const { emitted, session } = await createSession("active");

    await session.handleAppendRequest({
      type: "agent.notebook.append.request",
      agentId: "agent-1",
      requestId: "append-request",
      expectedRevision: 0,
      entry: { kind: "note_added", markdown: "Keep this visible" },
    });
    await session.handleGetRequest({
      type: "agent.notebook.get.request",
      agentId: "agent-1",
      requestId: "get-request",
    });

    expect(emitted[0]).toMatchObject({
      type: "agent.notebook.append.response",
      payload: { requestId: "append-request", result: { status: "applied" } },
    });
    expect(emitted[1]).toMatchObject({
      type: "agent.notebook.get.response",
      payload: {
        requestId: "get-request",
        result: { status: "found", writable: true, readOnlyReason: null },
      },
    });
  });

  it("allows archived notebook reads but rejects writes at the server boundary", async () => {
    const { emitted, session } = await createSession("archived");

    await session.handleGetRequest({
      type: "agent.notebook.get.request",
      agentId: "agent-1",
      requestId: "archived-get",
    });
    await session.handleAppendRequest({
      type: "agent.notebook.append.request",
      agentId: "agent-1",
      requestId: "archived-append",
      expectedRevision: 0,
      entry: { kind: "note_added", markdown: "Must not be written" },
    });

    expect(emitted[0]).toMatchObject({
      payload: {
        requestId: "archived-get",
        result: {
          status: "found",
          writable: false,
          readOnlyReason: "agent_archived",
          notebook: { revision: 0 },
          events: [],
        },
      },
    });
    expect(emitted[1]).toMatchObject({
      payload: {
        requestId: "archived-append",
        result: { status: "error", code: "agent_archived" },
      },
    });
  });

  it("returns correlated not-found errors without creating a notebook", async () => {
    const { emitted, session } = await createSession("missing");

    await session.handleGetRequest({
      type: "agent.notebook.get.request",
      agentId: "missing-agent",
      requestId: "missing-get",
    });

    expect(emitted).toEqual([
      {
        type: "agent.notebook.get.response",
        payload: {
          requestId: "missing-get",
          result: {
            status: "error",
            code: "agent_not_found",
            message: "Agent not found",
          },
        },
      },
    ]);
  });

  it("reconciles deterministic derived sources before returning an active notebook", async () => {
    const { emitted, session } = await createSession("active", {
      links: [
        {
          url: "https://paseo.sh/",
          source: {
            agentId: "agent-1",
            timelineSequence: 2,
            role: "assistant",
          },
        },
      ],
      artifacts: [],
    });

    await session.handleGetRequest({
      type: "agent.notebook.get.request",
      agentId: "agent-1",
      requestId: "derived-get",
    });

    expect(emitted[0]).toMatchObject({
      payload: {
        requestId: "derived-get",
        result: {
          status: "found",
          notebook: { revision: 1, lastSequence: 1 },
          events: [{ kind: "link_captured", url: "https://paseo.sh/" }],
        },
      },
    });
  });
});
