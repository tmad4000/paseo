import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForkAgentRequest } from "./use-fork-agent";
import { useForkAgent } from "./use-fork-agent";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  attachments: vi.fn(),
  editDraft: vi.fn(),
  navigate: vi.fn(),
  beside: vi.fn(),
  error: vi.fn(),
  compact: false,
  supported: true,
}));
vi.mock("@/i18n/i18next", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-stable-event", () => ({ useStableEvent: (fn: unknown) => fn }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => mocks.compact }));
vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => mocks.supported }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (select: (state: unknown) => unknown) =>
    select({ sessions: { host: { client: { buildAgentForkContext: mocks.context } } } }),
}));
vi.mock("@/stores/draft-store", () => ({
  useDraftStore: { getState: () => ({ editDraftText: mocks.editDraft }) },
}));
vi.mock("@/stores/draft-keys", () => ({
  generateDraftId: () => "continuation",
  buildDraftStoreKey: () => "draft:host:continuation",
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: mocks.navigate,
}));
vi.mock("@/workspace-tabs/open-beside", () => ({ openWorkspaceTargetBeside: mocks.beside }));
vi.mock("@/attachments/workspace-attachments-store", () => ({
  buildDraftWorkspaceAttachmentScopeKey: (id: string) => id,
  useWorkspaceAttachmentsStore: {
    getState: () => ({ setWorkspaceAttachments: mocks.attachments }),
  },
}));
vi.mock("@/stores/workspace-draft-submission-store", () => ({
  useWorkspaceDraftSubmissionStore: { getState: () => ({ setDraftSetup: vi.fn() }) },
}));
vi.mock("@/threads/draft-store", () => ({
  useThreadDraftStore: { getState: () => ({ setOrigin: vi.fn() }) },
}));

const history = { type: "text", text: "retained chat", contextKind: "chat_history" };
function request(): ForkAgentRequest {
  return {
    agentId: "source",
    workspaceId: "workspace",
    target: "split",
    agent: {
      provider: "claude",
      cwd: "/project",
      currentModeId: "bypassPermissions",
      model: "original",
      features: [{ id: "old-flag", type: "toggle", label: "Old", value: true }],
    },
    handoff: { provider: "codex", modelId: "chosen" },
  };
}

function createForkDriver() {
  let driver: ReturnType<typeof useForkAgent> | undefined;
  function HookDriver() {
    driver = useForkAgent({
      serverId: "host",
      toast: { error: mocks.error, show: vi.fn(), copied: vi.fn() },
    });
    return null;
  }
  renderToStaticMarkup(createElement(HookDriver));
  if (!driver) throw new Error("Hook did not render");
  return driver;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.compact = false;
  mocks.supported = true;
  mocks.context.mockResolvedValue({ attachment: history, itemCount: 3, boundaryMessageId: "last" });
});

describe("limit handoff through the real fork driver", () => {
  it("carries history, explicit agent choice and continuation text to a sibling draft", async () => {
    await createForkDriver()(request());
    expect(mocks.context).toHaveBeenCalledWith("source", undefined);
    expect(mocks.attachments).toHaveBeenCalledWith({
      scopeKey: "continuation",
      attachments: [
        expect.objectContaining({
          attachment: history,
          source: expect.objectContaining({ serverId: "host", agentId: "source", itemCount: 3 }),
        }),
      ],
    });
    expect(mocks.editDraft).toHaveBeenCalledWith({
      draftKey: "draft:host:continuation",
      text: expect.stringContaining("Source conversation: source on host host."),
    });
    expect(mocks.beside).toHaveBeenCalledWith({
      workspaceKey: "host:workspace",
      target: {
        kind: "draft",
        draftId: "continuation",
        setup: {
          provider: "codex",
          model: "chosen",
          cwd: "/project",
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        },
      },
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("opens a tab in the original workspace on phones", async () => {
    mocks.compact = true;
    await createForkDriver()(request());
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "host",
        workspaceId: "workspace",
        target: expect.objectContaining({ kind: "draft" }),
      }),
    );
    expect(mocks.beside).not.toHaveBeenCalled();
  });

  it("preserves ordinary forks without inserting a continuation prompt", async () => {
    const ordinary = request();
    delete ordinary.handoff;
    await createForkDriver()(ordinary);
    expect(mocks.editDraft).not.toHaveBeenCalled();
    expect(mocks.beside.mock.calls[0][0].target.setup.provider).toBe("claude");
  });

  it("rejects the limited provider before preparing any draft", async () => {
    const same = request();
    same.handoff = { provider: "claude", modelId: "other" };
    await createForkDriver()(same);
    expect(mocks.error).toHaveBeenCalledWith("agentPanel.limitHandoff.chooseAnother");
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.beside).not.toHaveBeenCalled();
  });

  it.each(["rejected", "missing"])(
    "does not open an empty continuation when context is %s",
    async (kind) => {
      if (kind === "rejected") mocks.context.mockRejectedValue(new Error("disconnected"));
      else mocks.context.mockResolvedValue({ attachment: null });
      await createForkDriver()(request());
      expect(mocks.error).toHaveBeenCalled();
      expect(mocks.attachments).not.toHaveBeenCalled();
      expect(mocks.editDraft).not.toHaveBeenCalled();
      expect(mocks.beside).not.toHaveBeenCalled();
    },
  );

  it("keeps the existing host capability gate", async () => {
    mocks.supported = false;
    await createForkDriver()(request());
    expect(mocks.error).toHaveBeenCalledWith("message.actions.forkUnavailable");
    expect(mocks.context).not.toHaveBeenCalled();
  });
});
