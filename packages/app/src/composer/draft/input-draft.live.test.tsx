/** @vitest-environment jsdom */
import { FailedPreparationRecovery } from "@/composer/submission/preparation-recovery";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getByRole, getByText } from "@testing-library/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "@/stores/draft-store";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
} from "@/attachments/types";
import { submitAgentInput } from "@/composer/submit";
import {
  dispatchComposerAgentMessage,
  queueComposerMessage,
  queueComposerMessageOnServer,
  type DirectSendOutbox,
  type QueueOutboxWriter,
  type QueuedComposerMessage,
} from "@/composer/actions";
import { queueInputMessage } from "@/composer/input/state";
import type { MessagePayload } from "@/composer/types";
import { FailedPreparationTrack } from "@/composer/failed-preparation-track";
import {
  failedPreparationRecovery,
  preparationRecoveryScopeKey,
  restoreFailedPreparation,
} from "@/composer/submission/preparation-recovery-store";
import { collectRetainedAttachmentIds } from "@/attachments/gc-retention";
import {
  buildReviewAttachmentSnapshot,
  resetReviewDraftStore,
  useReviewDraftStore,
} from "@/review/store";
import { useWorkspaceAttachmentsStore } from "@/attachments/workspace-attachments-store";
import { userAttachmentsOnly } from "@/attachments/workspace-attachment-utils";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";

const { asyncStorage } = vi.hoisted(() => ({
  asyncStorage: new Map<string, string>(),
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorage.delete(key);
    },
  },
}));

vi.mock("@/attachments/service", () => ({
  garbageCollectAttachments: async () => undefined,
}));

vi.mock("@/hooks/use-agent-form-state", () => ({
  useAgentFormState: () => ({
    selectedServerId: "host-1",
    selectedProvider: "codex",
    setProviderFromUser: () => undefined,
    selectedMode: "auto",
    setModeFromUser: () => undefined,
    selectedModel: "",
    setModelFromUser: () => undefined,
    selectedThinkingOptionId: "",
    setThinkingOptionFromUser: () => undefined,
    workingDir: "/repo",
    providerDefinitions: [{ id: "codex", label: "Codex", modes: [{ id: "auto", label: "Auto" }] }],
    providerDefinitionMap: new Map(),
    agentDefinition: undefined,
    modeOptions: [{ id: "auto", label: "Auto" }],
    availableModels: [
      {
        provider: "codex",
        id: "gpt-5.4",
        label: "gpt-5.4",
        isDefault: true,
        defaultThinkingOptionId: "high",
        thinkingOptions: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
    ],
    allProviderModels: new Map([
      [
        "codex",
        [
          {
            provider: "codex",
            id: "gpt-5.4",
            label: "gpt-5.4",
            isDefault: true,
            defaultThinkingOptionId: "high",
            thinkingOptions: [
              { id: "medium", label: "Medium" },
              { id: "high", label: "High", isDefault: true },
            ],
          },
        ],
      ],
    ]),
    modelSelectorProviders: [
      {
        id: "codex",
        label: "Codex",
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "codex:gpt-5.4",
              provider: "codex",
              providerLabel: "Codex",
              modelId: "gpt-5.4",
              modelLabel: "gpt-5.4",
              isDefault: true,
            },
          ],
        },
      },
    ],
    isAllModelsLoading: false,
    isProviderModelsRefreshing: false,
    availableThinkingOptions: [
      { id: "medium", label: "Medium" },
      { id: "high", label: "High", isDefault: true },
    ],
    isModelLoading: false,
    modelError: null,
    refreshProviderModels: () => undefined,
    setProviderAndModelFromUser: () => undefined,
    workingDirIsEmpty: false,
    persistFormPreferences: async () => undefined,
  }),
}));

const mountedRoots = new Set<Root>();
function createTestRoot(container: HTMLElement): Root {
  const root = createRoot(container);
  mountedRoots.add(root);
  return root;
}

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots) root.unmount();
    mountedRoots.clear();
  });
});

let useAgentInputDraft: typeof import("./input-draft").useAgentInputDraft;
type DraftRecordForTest = ReturnType<typeof useDraftStore.getState>["drafts"][string];

beforeAll(async () => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });

  ({ useAgentInputDraft } = await import("./input-draft"));
});

describe("useAgentInputDraft live contract", () => {
  beforeEach(() => {
    asyncStorage.clear();
    document.body.innerHTML = "<div id='root'></div>";
    localStorage.clear();

    useDraftStore.setState({
      drafts: {},
      createModalDraft: null,
      attachmentFocusRequestByDraftKey: {},
    });
  });

  it("hydrates persisted text and attachments and returns draft-mode composer state for a caller-provided key", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "attachment-1",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/1",
      createdAt: 1,
      fileName: "image.png",
      byteSize: 128,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe({ draftKey }: { draftKey: string }) {
      latest = useAgentInputDraft({
        draftKey,
        composer: {
          initialServerId: "host-1",
          isVisible: true,
          lockedWorkingDir: "/repo",
        },
      });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    let root: Root | null = createTestRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Probe draftKey="draft:setup" />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().composerState?.agentControls.selectedProvider).toBe("codex");
    expect(getLatest().composerState?.commandDraftConfig).toEqual({
      provider: "codex",
      cwd: "/repo",
      modeId: "auto",
      model: "gpt-5.4",
      thinkingOptionId: "high",
    });

    const hydratedTextReplacement = getLatest().textReplacement;

    await act(async () => {
      getLatest().editText("hello world");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    expect(getLatest().textReplacement).toBe(hydratedTextReplacement);

    await act(async () => {
      getLatest().replaceText("replacement text");
    });

    expect(getLatest().textReplacement).not.toBe(hydratedTextReplacement);
    expect(getLatest().textReplacement.text).toBe("replacement text");

    await act(async () => {
      getLatest().editText("hello world");
    });

    await act(async () => {
      root!.unmount();
    });

    root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe draftKey="draft:setup" />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().textSource.getSnapshot()).toBe("hello world");
    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
  });

  it("migrates legacy image drafts to image attachments on hydration", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "legacy-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/legacy-image",
      createdAt: 10,
      fileName: "legacy.png",
      byteSize: 512,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    useDraftStore.setState({
      drafts: {
        "draft:legacy": {
          input: {
            text: "legacy text",
            images: [image],
          },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
      createModalDraft: null,
    });

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:legacy" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().textSource.getSnapshot()).toBe("legacy text");
    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
    expect(useDraftStore.getState().drafts["draft:legacy"]?.input).toEqual({
      text: "legacy text",
      attachments: [{ kind: "image", metadata: image }],
    });
  });

  it("hydrates drafts saved by old builds with cwd", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const githubIssue: ComposerAttachment = {
      kind: "github_issue",
      item: {
        kind: "issue",
        number: 42,
        title: "Unify attachments",
        url: "https://github.com/paseo/paseo/issues/42",
        state: "open",
        body: "body",
        labels: ["composer"],
      },
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    useDraftStore.setState({
      drafts: {
        "draft:new-shape": {
          input: {
            text: "new text",
            attachments: [githubIssue],
            cwd: "/persisted",
          },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
      createModalDraft: null,
    });

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:new-shape" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().textSource.getSnapshot()).toBe("new text");
    expect(getLatest().attachments).toEqual([githubIssue]);

    await act(async () => {
      root.unmount();
    });

    expect(useDraftStore.getState().drafts["draft:new-shape"]?.input).toEqual({
      text: "new text",
      attachments: [githubIssue],
      cwd: "/persisted",
    });
  });

  it("updates and persists attachments through setAttachments", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "next-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/next-image",
      createdAt: 11,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    let renders = 0;
    function Probe() {
      renders += 1;
      latest = useAgentInputDraft({ draftKey: "draft:attachments" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().editText("with attachment");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
    const readPersistedInput = () => useDraftStore.getState().drafts["draft:attachments"]?.input;
    await act(async () => {
      // Web text publication occurs after paint; attachments save immediately.
      await expect.poll(readPersistedInput).toEqual({
        text: "with attachment",
        attachments: [{ kind: "image", metadata: image }],
      });
    });
    const settledRenders = renders;
    const attached = getLatest().attachments;
    const source = getLatest().textSource;
    let textNotifications = 0;
    const unsubscribe = source.subscribe(() => {
      textNotifications += 1;
    });
    await act(async () => {
      getLatest().editText("with attachment\n");
      await expect.poll(source.getSnapshot).toBe("with attachment\n");
    });
    expect(renders).toBe(settledRenders);
    expect(getLatest().attachments).toBe(attached);
    expect(getLatest().textSource).toBe(source);
    expect(textNotifications).toBe(1);
    unsubscribe();
    await act(async () => {
      root.unmount();
    });
  });

  it("attaches to an unmounted legacy draft without losing its input", async () => {
    const image: AttachmentMetadata = {
      id: "legacy-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/legacy-image",
      createdAt: 10,
    };
    useDraftStore.setState({
      drafts: {
        "draft:legacy-workspace-file": {
          input: { text: "legacy text", images: [image] },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
    });

    await useDraftStore.getState().attachWorkspaceFile({
      draftKey: "draft:legacy-workspace-file",
      attachment: createWorkspaceFileAttachment({ path: "src/app.ts" }),
    });

    expect(useDraftStore.getState().getDraftInput("draft:legacy-workspace-file")).toEqual({
      text: "legacy text",
      attachments: [
        { kind: "image", metadata: image },
        createWorkspaceFileAttachment({ path: "src/app.ts" }),
      ],
    });
  });

  it("clear resets text and attachments", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "clear-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/clear-image",
      createdAt: 12,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:clear" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().editText("queued message");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    await act(async () => {
      getLatest().clear("sent");
    });

    expect(getLatest().textSource.getSnapshot()).toBe("");
    expect(getLatest().attachments).toEqual([]);
    expect(useDraftStore.getState().drafts["draft:clear"]?.input).toEqual({
      text: "",
      attachments: [],
    });
  });

  it("clears drafts with sent and abandoned lifecycle tombstones", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const sentImage: AttachmentMetadata = {
      id: "attachment-sent",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/sent",
      createdAt: 2,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:lifecycle" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().editText("queued message");
      getLatest().setAttachments([{ kind: "image", metadata: sentImage }]);
    });

    await act(async () => {
      getLatest().clear("sent");
    });

    expect(getLatest().textSource.getSnapshot()).toBe("");
    expect(getLatest().attachments).toEqual([]);
    expect(useDraftStore.getState().drafts["draft:lifecycle"]).toMatchObject({
      lifecycle: "sent",
      input: { text: "", attachments: [] },
    });

    await act(async () => {
      getLatest().editText("draft again");
    });

    await act(async () => {
      getLatest().clear("abandoned");
    });

    expect(useDraftStore.getState().drafts["draft:lifecycle"]).toMatchObject({
      lifecycle: "abandoned",
      input: { text: "", attachments: [] },
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type PreparationStage = "encode" | "save";
type PreparationOutcome = "success" | "failure";
const DIRECT_SETTLEMENT_EDITS = [
  "text",
  "text-aba",
  "same-text",
  "add",
  "remove",
  "attachment-aba",
  "store",
  "unchanged",
] as const;
interface DirectSettlementCase {
  stage: PreparationStage;
  outcome: PreparationOutcome;
  edit: (typeof DIRECT_SETTLEMENT_EDITS)[number];
  behavior: "clear" | "preserve-and-lock";
}

function createDirectSettlementCases(): DirectSettlementCase[] {
  const cases: DirectSettlementCase[] = [];
  for (const stage of ["encode", "save"] as const) {
    for (const outcome of ["success", "failure"] as const) {
      for (const edit of DIRECT_SETTLEMENT_EDITS) {
        cases.push({ stage, outcome, edit, behavior: "clear" });
      }
      cases.push({ stage, outcome, edit: "unchanged", behavior: "preserve-and-lock" });
    }
  }
  return cases;
}

function encodeImageMetadata(image: AttachmentMetadata) {
  return { data: image.id, mimeType: image.mimeType };
}

describe("draft settlement through submission and device save", () => {
  beforeEach(() => {
    asyncStorage.clear();
    document.body.innerHTML = "<div id='root'></div>";
    useDraftStore.setState({ drafts: {}, createModalDraft: null });
  });

  const cases = createDirectSettlementCases();
  it.each(cases)(
    "retains $edit edits during $stage $outcome ($behavior)",
    async ({ stage, outcome, edit, behavior }) => {
      let latest: ReturnType<typeof useAgentInputDraft> | null = null;
      function draft(): ReturnType<typeof useAgentInputDraft> {
        if (!latest) throw new Error("Draft not mounted");
        return latest;
      }
      function Probe() {
        latest = useAgentInputDraft({ draftKey: "draft:settlement" });
        return null;
      }
      const container = document.getElementById("root")!;
      const root = createTestRoot(container);
      const queryClient = new QueryClient();
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        );
      });
      const original: UserComposerAttachment[] = [
        {
          kind: "image",
          metadata: {
            id: "original",
            storageKey: "original",
            storageType: "web-indexeddb",
            mimeType: "image/png",
            createdAt: 1,
          },
        },
      ];
      const added = createWorkspaceFileAttachment({ path: "new.ts" });
      await act(async () => {
        draft().replaceText("first");
        draft().setAttachments(original);
      });
      const pending = deferred<void>();
      const entered = deferred<void>();
      const hostAck = deferred<void>();
      const saved: Parameters<DirectSendOutbox["add"]>[0][] = [];
      const flush = vi.fn(() => hostAck.promise);
      const begin = vi.fn();
      const reject = vi.fn(() => "rejected" as const);
      const processing = vi.fn();
      const clear = vi.fn((lifecycle: "sent" | "abandoned") => draft().clear(lifecycle));
      let result!: ReturnType<typeof submitAgentInput>;
      await act(async () => {
        result = submitAgentInput({
          message: "first",
          attachments: original,
          submitBehavior: behavior,
          isAgentRunning: false,
          canSubmit: true,
          getDraftRevision: () => draft().textSource.getRevision!(),
          recovery: new FailedPreparationRecovery<ComposerAttachment>().forScope("test"),
          queueMessage: vi.fn(),
          submitMessage: ({ message, attachments }) =>
            dispatchComposerAgentMessage({
              client: {
                sendAgentMessage: async () => ({ queued: false }),
                uploadFile: async () => ({ requestId: "unused", file: null, error: null }),
              },
              agentId: "agent",
              text: message,
              attachments,
              encodeImages: async (images) => {
                if (stage === "encode") {
                  entered.resolve();
                  await pending.promise;
                }
                return images.map(encodeImageMetadata);
              },
              submission: { begin, reject, accept: vi.fn() },
              outbox: {
                serverId: "server",
                add: async (entry) => {
                  if (stage === "save") {
                    entered.resolve();
                    await pending.promise;
                  }
                  saved.push(entry);
                },
                flush,
                get: () => undefined,
                remove: async () => {},
              },
            }),
          clearDraft: clear,
          setUserInput: (text) => draft().editText(text),
          setAttachments: (attachments) => draft().setAttachments(attachments),
          setSendError: vi.fn(),
          setIsProcessing: processing,
        });
        await entered.promise;
      });
      expect(saved).toEqual([]);
      expect(draft().textSource.getSnapshot()).toBe(behavior === "clear" ? "" : "first");
      expect(draft().attachments).toEqual(behavior === "clear" ? [] : original);
      expect(processing).toHaveBeenLastCalledWith(true);
      let expected = { text: "", attachments: [] as UserComposerAttachment[] };
      await act(async () => {
        switch (edit) {
          case "text":
            draft().editText("new draft");
            expected.text = "new draft";
            break;
          case "text-aba":
            draft().editText("temporary");
            draft().editText("");
            break;
          case "same-text":
            draft().editText("first");
            expected.text = "first";
            break;
          case "add":
            draft().setAttachments([added]);
            expected.attachments = [added];
            break;
          case "remove":
            draft().setAttachments([added]);
            draft().setAttachments([]);
            break;
          case "attachment-aba":
            draft().setAttachments(original);
            draft().setAttachments([]);
            break;
          case "store":
            useDraftStore.getState().saveDraftInput({
              draftKey: "draft:settlement",
              draft: { text: "external edit", attachments: [added] },
            });
            expected = { text: "external edit", attachments: [added] };
            break;
          case "unchanged":
            break;
        }
        if (outcome === "failure") pending.reject(new Error("preparation failed"));
        else pending.resolve();
        expect(await result).toBe(outcome === "success" ? "submitted" : "failed");
        draft().textSource.getRevision!();
      });
      expect(processing).toHaveBeenLastCalledWith(false);
      if (edit === "unchanged" && outcome === "failure") {
        expected = { text: "first", attachments: original };
      }
      expect(draft().textSource.getSnapshot()).toBe(expected.text);
      expect(draft().attachments).toEqual(expected.attachments);
      if (edit === "unchanged" && outcome === "success") {
        expect(clear).toHaveBeenCalledExactlyOnceWith("sent");
        expect(useDraftStore.getState().drafts["draft:settlement"].lifecycle).toBe("sent");
      } else {
        expect(clear).not.toHaveBeenCalled();
      }
      if (outcome === "success") {
        expect(saved).toEqual([
          expect.objectContaining({
            text: "first",
            images: [{ data: "original", mimeType: "image/png" }],
            clientMessageId: begin.mock.calls[0][1].clientMessageId,
          }),
        ]);
        expect(flush).toHaveBeenCalledExactlyOnceWith("agent");
        expect(reject).not.toHaveBeenCalled();
      } else {
        expect(saved).toEqual([]);
        expect(flush).not.toHaveBeenCalled();
        expect(reject).toHaveBeenCalledExactlyOnceWith(
          "agent",
          begin.mock.calls[0][1].clientMessageId,
        );
      }
      hostAck.resolve();
    },
  );
});

type QueuePreparationStage = PreparationStage | "legacy";
type QueueEntryPath = "default" | "input" | "keep";
const QUEUE_SETTLEMENT_EDITS = [
  "text",
  "aba",
  "add",
  "remove",
  "attachment-aba",
  "unchanged",
] as const;
interface QueueSettlementCase {
  stage: QueuePreparationStage;
  outcome: PreparationOutcome;
  edit: (typeof QUEUE_SETTLEMENT_EDITS)[number];
  route: QueueEntryPath;
}
const QUEUE_PREPARATIONS: Array<Pick<QueueSettlementCase, "stage" | "outcome">> = [
  { stage: "encode", outcome: "success" },
  { stage: "encode", outcome: "failure" },
  { stage: "save", outcome: "success" },
  { stage: "save", outcome: "failure" },
  { stage: "legacy", outcome: "success" },
  { stage: "legacy", outcome: "failure" },
];

function createQueueSettlementCases(): QueueSettlementCase[] {
  const cases: QueueSettlementCase[] = [];
  for (const route of ["default", "input"] as const) {
    for (const preparation of QUEUE_PREPARATIONS) {
      for (const edit of QUEUE_SETTLEMENT_EDITS) {
        cases.push({ ...preparation, edit, route });
      }
    }
  }
  for (const preparation of QUEUE_PREPARATIONS) {
    cases.push({ ...preparation, edit: "unchanged", route: "keep" });
  }
  return cases;
}

type LiveDraft = ReturnType<typeof useAgentInputDraft>;
async function mountQueueDraft() {
  let latest: LiveDraft | null = null;
  function draft(): LiveDraft {
    if (!latest) throw new Error("Draft not mounted");
    return latest;
  }
  function Probe() {
    latest = useAgentInputDraft({ draftKey: "draft:queued-settlement" });
    return null;
  }
  const root = createTestRoot(document.getElementById("root")!);
  const queryClient = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return draft;
}

function startQueueSubmission(
  route: QueueEntryPath,
  payload: MessagePayload,
  draft: () => LiveDraft,
  onQueue: () => Promise<boolean>,
  clearInput: () => void,
) {
  const getDraftRevision = () => draft().textSource.getRevision!();
  if (route === "default") {
    return submitAgentInput({
      message: payload.text,
      attachments: payload.attachments,
      isAgentRunning: true,
      canSubmit: true,
      getDraftRevision,
      recovery: new FailedPreparationRecovery<ComposerAttachment>().forScope("test"),
      queueMessage: async () => {
        await onQueue();
      },
      submitMessage: async () => {
        throw new Error("Queued send was dispatched directly");
      },
      clearDraft: () => {
        throw new Error("Shared submit cleared the queued draft independently");
      },
      setUserInput: () => {
        throw new Error("Shared submit replaced queued input");
      },
      setAttachments: () => {
        throw new Error("Shared submit replaced queued attachments");
      },
      setSendError: () => {},
      setIsProcessing: () => {},
    });
  }
  if (route === "keep") return onQueue();
  return queueInputMessage(payload, onQueue, {
    getDraftRevision,
    clearDraft: clearInput,
  });
}

function queueSubmissionFailure() {
  return "failed";
}

describe("Queue draft settlement", () => {
  beforeEach(() => {
    asyncStorage.clear();
    document.body.innerHTML = "<div id='root'></div>";
    useDraftStore.setState({ drafts: {}, createModalDraft: null });
  });

  it.each(createQueueSettlementCases())(
    "preserves $edit through $route Queue during $stage $outcome",
    async ({ stage, outcome, edit, route }) => {
      const draft = await mountQueueDraft();
      const original: UserComposerAttachment[] = [
        {
          kind: "image",
          metadata: {
            id: "queued-image",
            storageKey: "queued-image",
            storageType: "web-indexeddb",
            mimeType: "image/png",
            createdAt: 1,
          },
        },
      ];
      const added = createWorkspaceFileAttachment({ path: "added.ts" });
      await act(async () => {
        draft().replaceText("A");
        draft().setAttachments(original);
      });
      const payload: MessagePayload = { text: "A", attachments: original, cwd: "/repo" };
      const pending = deferred<void>();
      const entered = deferred<void>();
      const hostAck = deferred<void>();
      const saved: Parameters<QueueOutboxWriter["add"]>[0][] = [];
      let queues = new Map<string, QueuedComposerMessage[]>();
      const queue = {
        read: (agentId: string) => queues.get(agentId) ?? [],
        write: (
          update: (
            previous: Map<string, QueuedComposerMessage[]>,
          ) => Map<string, QueuedComposerMessage[]>,
        ) => {
          if (stage === "legacy" && outcome === "failure") throw new Error("legacy save failed");
          queues = update(queues);
        },
      };
      const flush = vi.fn(() => hostAck.promise);
      const clearRoot = vi.fn(() => {
        draft().editText("");
        draft().setAttachments([]);
      });
      const clearInput = vi.fn(() => draft().editText(""));
      const enqueue = async () => {
        if (stage === "legacy") {
          entered.resolve();
          return Boolean(
            queueComposerMessage({ agentId: "agent", text: "A", attachments: original, queue })
              .queued,
          );
        }
        const result = await queueComposerMessageOnServer({
          client: {
            enqueueAgentMessage: async () => {
              throw new Error("Queue waited for host acknowledgement");
            },
            removeQueuedAgentMessage: async () => ({ agentId: "agent", revision: 1, items: [] }),
            getQueuedAgentMessageImages: async () => [],
          },
          agentId: "agent",
          text: "A",
          attachments: original,
          encodeImages: async (images) => {
            if (stage === "encode") {
              entered.resolve();
              await pending.promise;
            }
            return images.map(encodeImageMetadata);
          },
          queue,
          applySnapshot: () => {},
          outbox: {
            serverId: "queue-settlement",
            add: async (entry) => {
              if (stage === "save") {
                entered.resolve();
                await pending.promise;
              }
              saved.push(entry);
            },
            remove: async () => {},
            flush,
          },
        });
        if (result.error) throw new Error(result.error);
        return Boolean(result.queued);
      };
      const onQueue = () =>
        queueInputMessage(payload, enqueue, {
          getDraftRevision: () => draft().textSource.getRevision!(),
          clearDraft: clearRoot,
          keepComposer: route === "keep",
        });
      let settlement!: Promise<unknown>;
      await act(async () => {
        settlement = startQueueSubmission(route, payload, draft, onQueue, clearInput).catch(
          queueSubmissionFailure,
        );
        if (stage !== "legacy") await entered.promise;
        switch (edit) {
          case "text":
            draft().editText("B");
            break;
          case "aba":
            draft().editText("B");
            draft().editText("A");
            break;
          case "add":
            draft().setAttachments([...original, added]);
            break;
          case "remove":
            draft().setAttachments([]);
            break;
          case "attachment-aba":
            draft().setAttachments([]);
            draft().setAttachments(original);
            break;
          case "unchanged":
            break;
        }
        if (outcome === "failure" && stage !== "legacy")
          pending.reject(new Error("queue preparation failed"));
        else pending.resolve();
        let expectedResult: boolean | string = true;
        if (route === "default") expectedResult = "queued";
        if (outcome === "failure") expectedResult = "failed";
        expect(await settlement).toBe(expectedResult);
        draft().textSource.getRevision!();
      });
      const shouldClear = edit === "unchanged" && outcome === "success" && route !== "keep";
      let expectedText = "A";
      if (edit === "text") expectedText = "B";
      if (shouldClear) expectedText = "";
      let expectedAttachments = original;
      if (shouldClear || edit === "remove") expectedAttachments = [];
      if (edit === "add") expectedAttachments = [...original, added];
      expect(draft().textSource.getSnapshot()).toBe(expectedText);
      expect(draft().attachments).toEqual(expectedAttachments);
      expect(clearRoot).toHaveBeenCalledTimes(shouldClear ? 1 : 0);
      expect(clearInput).not.toHaveBeenCalled();
      if (outcome === "success" && stage !== "legacy") {
        expect(saved).toEqual([
          expect.objectContaining({
            agentId: "agent",
            text: "A",
            images: [{ data: "queued-image", mimeType: "image/png" }],
          }),
        ]);
        expect(flush).toHaveBeenCalledTimes(1);
      } else {
        expect(saved).toEqual([]);
        expect(flush).not.toHaveBeenCalled();
      }
      if (stage === "legacy" && outcome === "success") {
        expect(queue.read("agent")).toEqual([
          expect.objectContaining({ text: "A", attachments: original }),
        ]);
      }
      hostAck.resolve();
    },
  );
});

const recoveryDiffFile: ParsedDiffFile = {
  path: "review.ts",
  isNew: false,
  isDeleted: false,
  additions: 1,
  deletions: 0,
  status: "ok",
  hunks: [
    {
      oldStart: 1,
      oldCount: 0,
      newStart: 1,
      newCount: 1,
      lines: [
        { type: "header", content: "@@ -1,0 +1,1 @@" },
        { type: "add", content: "const original = true;" },
      ],
    },
  ],
};
function imageForRecovery(id: string): UserComposerAttachment {
  return {
    kind: "image",
    metadata: {
      id,
      storageKey: id,
      storageType: "web-indexeddb",
      mimeType: "image/png",
      createdAt: 1,
    },
  };
}
function recoveryReviewSnapshot() {
  const snapshot = buildReviewAttachmentSnapshot({
    reviewDraftKey: "recovery-review",
    cwd: "/repo",
    mode: "uncommitted",
    comments: useReviewDraftStore.getState().drafts["recovery-review"] ?? [],
    diffFiles: [recoveryDiffFile],
  });
  if (!snapshot) throw new Error("Missing review snapshot");
  return snapshot;
}
const failedPreparations = [
  { path: "durable", stage: "encode" },
  { path: "durable", stage: "save" },
  { path: "legacy", stage: "encode" },
] as const;

function livePreparationRestore(
  draft: Awaited<ReturnType<typeof mountQueueDraft>>,
  scopeKey: string,
) {
  return (id: string) =>
    restoreFailedPreparation({
      id,
      scopeKey,
      occupiedMessage: "Finish B before restoring A",
      getCurrentDraft: () => {
        const current = draft().textSource.getDraftSnapshot!();
        return {
          message: current.text,
          attachments: [
            ...current.attachments,
            ...(useWorkspaceAttachmentsStore.getState().attachmentsByScope["B-context"] ?? []),
          ],
        };
      },
      apply: (snapshot) => {
        useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
          scopeKey: "restored-context",
          attachments: snapshot.attachments.filter(
            (attachment) => attachment.kind === "review" || attachment.kind === "chat_history",
          ),
        });
        draft().setAttachments(userAttachmentsOnly(snapshot.attachments));
        draft().replaceText(snapshot.message);
      },
    });
}

describe("failed preparation copies through the live draft and recovery actions", () => {
  beforeEach(() => {
    asyncStorage.clear();
    document.body.innerHTML = "<div id='root'></div><div id='recovery'></div>";
    useDraftStore.setState({ drafts: {}, createModalDraft: null });
    useWorkspaceAttachmentsStore.setState({ attachmentsByScope: {} });
    resetReviewDraftStore();
    for (const entry of failedPreparationRecovery.getSnapshot())
      failedPreparationRecovery.discard(entry.id);
  });
  afterEach(() => {
    for (const entry of failedPreparationRecovery.getSnapshot())
      failedPreparationRecovery.discard(entry.id);
  });

  it.each(failedPreparations)(
    "keeps A recoverable after $path $stage fails while B has newer images and review content",
    async ({ path, stage }) => {
      const draft = await mountQueueDraft();
      const imageA = imageForRecovery("retained-A-image");
      const imageB = imageForRecovery("newer-B-image");
      useReviewDraftStore.getState().addComment({
        key: "recovery-review",
        comment: {
          id: "comment",
          filePath: "review.ts",
          side: "new",
          lineNumber: 1,
          body: "A review version",
        },
      });
      const reviewA = recoveryReviewSnapshot();
      const contextA: ComposerAttachment = {
        kind: "chat_history",
        id: "original-context",
        source: { serverId: "server", agentId: "source" },
        attachment: {
          type: "text",
          mimeType: "text/plain",
          contextKind: "chat_history",
          text: "Original context",
          title: "Original chat",
        },
      };
      const original: ComposerAttachment[] = [imageA, reviewA, contextA];
      const messageA = "  exact A\n";
      await act(async () => {
        draft().replaceText(messageA);
        draft().setAttachments([imageA]);
      });
      const pending = deferred<void>();
      const entered = deferred<void>();
      const send = vi.fn(async () => ({ queued: false }));
      const add = vi.fn(async () => {
        entered.resolve();
        await pending.promise;
      });
      const flush = vi.fn(async () => {});
      const scopeKey = preparationRecoveryScopeKey("server", "agent");
      const recovery = failedPreparationRecovery.forScope(scopeKey);
      let result!: ReturnType<typeof submitAgentInput>;
      await act(async () => {
        result = submitAgentInput({
          message: messageA,
          attachments: original,
          isAgentRunning: false,
          canSubmit: true,
          getDraftRevision: () => draft().textSource.getRevision!(),
          recovery,
          queueMessage: () => {},
          submitMessage: ({ message, attachments }) =>
            dispatchComposerAgentMessage({
              client: {
                sendAgentMessage: send,
                uploadFile: async () => ({ requestId: "unused", file: null, error: null }),
              },
              agentId: "agent",
              text: message,
              attachments,
              encodeImages: async () => {
                if (stage === "encode") {
                  entered.resolve();
                  await pending.promise;
                }
                return [{ data: "original-A-bytes", mimeType: "image/png" }];
              },
              submission: { begin: () => {}, accept: () => {}, reject: () => "rejected" },
              outbox:
                path === "durable"
                  ? { serverId: "server", add, flush, get: () => undefined, remove: async () => {} }
                  : undefined,
            }),
          clearDraft: draft().clear,
          setUserInput: (text) => draft().editText(text),
          setAttachments: (attachments) => draft().setAttachments(userAttachmentsOnly(attachments)),
          setSendError: () => {},
          setIsProcessing: () => {},
        });
        await entered.promise;
      });
      expect(collectRetainedAttachmentIds().has("retained-A-image")).toBe(true);
      let reviewB!: ReturnType<typeof recoveryReviewSnapshot>;
      await act(async () => {
        draft().editText("newer B");
        draft().setAttachments([imageB]);
        useReviewDraftStore.getState().updateComment({
          key: "recovery-review",
          id: "comment",
          updates: { body: "B review version" },
        });
        reviewB = recoveryReviewSnapshot();
        useWorkspaceAttachmentsStore
          .getState()
          .setWorkspaceAttachments({ scopeKey: "B-context", attachments: [reviewB] });
        pending.reject(new Error(stage === "encode" ? "image read failed" : "device write failed"));
        expect(await result).toBe("failed");
      });
      expect(draft().textSource.getSnapshot()).toBe("newer B");
      expect(draft().attachments).toEqual([imageB]);
      expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope["B-context"]).toEqual([
        reviewB,
      ]);
      expect(failedPreparationRecovery.getSnapshot()).toHaveLength(1);
      const [copy] = failedPreparationRecovery.getSnapshot();
      expect(copy.message).toBe(messageA);
      expect(copy.attachments).toEqual(original);
      expect(copy.attachments[0]).toBe(imageA);
      expect(copy.attachments[1]).toBe(reviewA);
      expect(collectRetainedAttachmentIds().has("retained-A-image")).toBe(true);
      const restore = livePreparationRestore(draft, scopeKey);
      const track = createTestRoot(document.getElementById("recovery")!);
      await act(async () => {
        track.render(<FailedPreparationTrack scopeKey={scopeKey} onRestore={restore} />);
      });
      expect(
        getByText(
          document.body,
          "Kept only while this app is open. This copy is not saved on the device.",
        ).textContent,
      ).toBe("Kept only while this app is open. This copy is not saved on the device.");
      await act(async () => {
        getByRole(document.body, "button", { name: "Restore draft" }).click();
      });
      expect(getByRole(document.body, "alert").textContent).toBe("Finish B before restoring A");
      expect(draft().textSource.getSnapshot()).toBe("newer B");
      expect(draft().attachments).toEqual([imageB]);
      expect(failedPreparationRecovery.getSnapshot()).toHaveLength(1);
      expect(collectRetainedAttachmentIds().has("retained-A-image")).toBe(true);
      await act(async () => {
        draft().clear("sent");
        useWorkspaceAttachmentsStore
          .getState()
          .clearWorkspaceAttachments({ scopeKey: "B-context" });
      });
      await act(async () => {
        getByRole(document.body, "button", { name: "Restore draft" }).click();
      });
      expect(draft().textSource.getSnapshot()).toBe(messageA);
      expect(draft().attachments).toEqual([imageA]);
      expect(
        useWorkspaceAttachmentsStore.getState().attachmentsByScope["restored-context"],
      ).toEqual([reviewA, contextA]);
      expect(useReviewDraftStore.getState().drafts["recovery-review"][0].body).toBe(
        "B review version",
      );
      expect(failedPreparationRecovery.getSnapshot()).toEqual([]);
      expect(collectRetainedAttachmentIds().has("retained-A-image")).toBe(false);
      expect(useDraftStore.getState().collectActiveAttachmentIds()).toContain("retained-A-image");
      expect(send).not.toHaveBeenCalled();
      expect(flush).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledTimes(stage === "save" ? 1 : 0);
    },
  );
});
