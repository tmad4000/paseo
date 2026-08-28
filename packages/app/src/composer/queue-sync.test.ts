import { describe, expect, it } from "vitest";
import type { AgentQueueSnapshot, ForgeSearchItem } from "@getpaseo/protocol/messages";

import type { AttachmentMetadata } from "@/attachments/types";
import {
  shouldApplyAgentQueueSnapshot,
  toQueuedComposerAttachments,
  toQueuedComposerMessages,
} from "./queue-sync";

const issueItem: ForgeSearchItem = {
  kind: "issue",
  number: 7,
  title: "Mirror the queue",
  url: "https://example.test/issues/7",
  state: "open",
  body: null,
  labels: [],
  baseRefName: null,
  headRefName: null,
};

const imageMetadata: AttachmentMetadata = {
  id: "img-1",
  mimeType: "image/png",
  storageType: "web-indexeddb",
  storageKey: "img-1",
  createdAt: 1,
};

function snapshot(overrides: Partial<AgentQueueSnapshot> = {}): AgentQueueSnapshot {
  return {
    agentId: "agent",
    revision: 1,
    items: [{ id: "item-1", text: "first", createdAt: "2026-01-01T00:00:00.000Z" }],
    ...overrides,
  };
}

describe("shouldApplyAgentQueueSnapshot", () => {
  it("applies the first snapshot it sees", () => {
    expect(shouldApplyAgentQueueSnapshot({ incomingRevision: 4, appliedRevision: undefined })).toBe(
      true,
    );
  });

  it("applies a newer revision", () => {
    expect(shouldApplyAgentQueueSnapshot({ incomingRevision: 5, appliedRevision: 4 })).toBe(true);
  });

  it("drops a snapshot that raced behind one already applied", () => {
    expect(shouldApplyAgentQueueSnapshot({ incomingRevision: 3, appliedRevision: 4 })).toBe(false);
  });

  it("drops a repeat of the revision already applied", () => {
    expect(shouldApplyAgentQueueSnapshot({ incomingRevision: 4, appliedRevision: 4 })).toBe(false);
  });
});

describe("toQueuedComposerMessages", () => {
  it("keeps the composer-side attachments so any device can edit the message", () => {
    const items = toQueuedComposerMessages(
      snapshot({
        items: [
          {
            id: "item-1",
            text: "look at this",
            createdAt: "2026-01-01T00:00:00.000Z",
            composerAttachments: [{ kind: "forge_issue", item: issueItem }],
            images: [{ id: "srv-1", mimeType: "image/png", byteSize: 3 }],
          },
        ],
      }),
    );

    expect(items).toEqual([
      {
        id: "item-1",
        text: "look at this",
        attachments: [{ kind: "forge_issue", item: issueItem }],
      },
    ]);
  });

  it("returns an empty attachment list when the item has none", () => {
    expect(toQueuedComposerMessages(snapshot())).toEqual([
      { id: "item-1", text: "first", attachments: [] },
    ]);
  });
});

describe("toQueuedComposerAttachments", () => {
  it("drops images, which travel as bytes instead", () => {
    expect(
      toQueuedComposerAttachments([
        { kind: "image", metadata: imageMetadata },
        { kind: "forge_issue", item: issueItem },
      ]),
    ).toEqual([{ kind: "forge_issue", item: issueItem }]);
  });

  it("keeps workspace file references, which resolve the same on any device", () => {
    expect(
      toQueuedComposerAttachments([
        { kind: "workspace_file", path: "src/main.ts", selection: { kind: "whole_file" } },
      ]),
    ).toEqual([{ kind: "workspace_file", path: "src/main.ts", selection: { kind: "whole_file" } }]);
  });
});
