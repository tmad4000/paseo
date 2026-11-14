import { FailedPreparationRecovery } from "@/composer/submission/preparation-recovery";
import { describe, expect, it, vi } from "vitest";
import { submitAgentInput } from "./submit";

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

describe("submitAgentInput", () => {
  it("clears the composer before an in-flight submit resolves", async () => {
    const deferred = createDeferredPromise<void>();
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {
      await deferred.promise;
    });
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    const submitPromise = submitAgentInput({
      message: "  hello world  ",
      attachments: [],
      isAgentRunning: false,
      canSubmit: true,
      queueMessage,
      submitMessage,
      getDraftRevision: () => 0,
      recovery: new FailedPreparationRecovery().forScope("test"),
      clearDraft,
      setUserInput,
      setAttachments,
      setSendError,
      setIsProcessing,
    });

    expect(queueMessage).not.toHaveBeenCalled();
    expect(submitMessage).toHaveBeenCalledWith({
      message: "hello world",
      attachments: [],
    });
    expect(setUserInput).toHaveBeenCalledWith("");
    expect(setAttachments).toHaveBeenCalledWith([]);
    expect(setSendError).toHaveBeenCalledWith(null);
    expect(setIsProcessing).toHaveBeenCalledWith(true);
    expect(clearDraft).not.toHaveBeenCalled();

    deferred.resolve();

    await expect(submitPromise).resolves.toBe("submitted");
    expect(clearDraft).toHaveBeenCalledWith("sent");
  });

  it("preserves the composer before an in-flight submit resolves when requested", async () => {
    const deferred = createDeferredPromise<void>();
    const attachments = [{ id: "img-1" }];
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {
      await deferred.promise;
    });
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    const submitPromise = submitAgentInput({
      message: "  keep me  ",
      attachments,
      submitBehavior: "preserve-and-lock",
      isAgentRunning: false,
      canSubmit: true,
      queueMessage,
      submitMessage,
      getDraftRevision: () => 0,
      recovery: new FailedPreparationRecovery().forScope("test"),
      clearDraft,
      setUserInput,
      setAttachments,
      setSendError,
      setIsProcessing,
    });

    expect(queueMessage).not.toHaveBeenCalled();
    expect(submitMessage).toHaveBeenCalledWith({
      message: "keep me",
      attachments,
    });
    expect(setUserInput).not.toHaveBeenCalled();
    expect(setAttachments).not.toHaveBeenCalled();
    expect(setSendError).toHaveBeenCalledWith(null);
    expect(setIsProcessing).toHaveBeenCalledWith(true);
    expect(clearDraft).not.toHaveBeenCalled();

    deferred.resolve();

    await expect(submitPromise).resolves.toBe("submitted");
    expect(clearDraft).toHaveBeenCalledWith("sent");
  });

  it("queues while the agent is running and clears after queue acceptance", async () => {
    const queueMessage = vi.fn();
    const submitMessage = vi.fn();
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    await expect(
      submitAgentInput({
        message: "  queued message  ",
        attachments: [{ id: "img-1" }],
        isAgentRunning: true,
        canSubmit: true,
        queueMessage,
        submitMessage,
        getDraftRevision: () => 0,
        recovery: new FailedPreparationRecovery().forScope("test"),
        clearDraft,
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
      }),
    ).resolves.toBe("queued");

    expect(queueMessage).toHaveBeenCalledWith({
      message: "queued message",
      attachments: [{ id: "img-1" }],
    });
    expect(submitMessage).not.toHaveBeenCalled();
    expect(setUserInput).not.toHaveBeenCalled();
    expect(setAttachments).not.toHaveBeenCalled();
    expect(setSendError).not.toHaveBeenCalled();
    expect(setIsProcessing.mock.calls).toEqual([[true], [false]]);
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("restores the composer when submit fails", async () => {
    const submitError = new Error("No host selected");
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {
      throw submitError;
    });
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();
    const onSubmitError = vi.fn();
    const attachments = [{ id: "img-1" }];

    await expect(
      submitAgentInput({
        message: "  hello world  ",
        attachments,
        isAgentRunning: false,
        canSubmit: true,
        queueMessage,
        submitMessage,
        getDraftRevision: () => 0,
        recovery: new FailedPreparationRecovery().forScope("test"),
        clearDraft,
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
        onSubmitError,
      }),
    ).resolves.toBe("failed");

    expect(onSubmitError).toHaveBeenCalledWith(submitError);
    expect(setUserInput).toHaveBeenNthCalledWith(1, "");
    expect(setUserInput).toHaveBeenNthCalledWith(2, "hello world");
    expect(setAttachments).toHaveBeenNthCalledWith(1, []);
    expect(setAttachments).toHaveBeenNthCalledWith(2, attachments);
    expect(setSendError).toHaveBeenNthCalledWith(1, null);
    expect(setSendError).toHaveBeenNthCalledWith(2, "No host selected");
    expect(setIsProcessing).toHaveBeenNthCalledWith(1, true);
    expect(setIsProcessing).toHaveBeenNthCalledWith(2, false);
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("restores a steered active-turn draft after an ambiguous immediate-send error", async () => {
    const error = new Error("connection lost after delivery");
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    await expect(
      submitAgentInput({
        message: "  steer this turn  ",
        attachments: [{ id: "img-1" }],
        forceSend: true,
        isAgentRunning: true,
        canSubmit: true,
        queueMessage: vi.fn(),
        submitMessage: async () => {
          throw error;
        },
        getDraftRevision: () => 0,
        recovery: new FailedPreparationRecovery().forScope("test"),
        clearDraft: vi.fn(),
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
      }),
    ).resolves.toBe("failed");

    expect(setUserInput).toHaveBeenNthCalledWith(1, "");
    expect(setUserInput).toHaveBeenNthCalledWith(2, "steer this turn");
    expect(setAttachments).toHaveBeenNthCalledWith(1, []);
    expect(setAttachments).toHaveBeenNthCalledWith(2, [{ id: "img-1" }]);
    expect(setSendError).toHaveBeenLastCalledWith("connection lost after delivery");
  });

  it("submits when empty submit is explicitly allowed", async () => {
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {});
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    await expect(
      submitAgentInput({
        message: "   ",
        attachments: [],
        allowEmptySubmit: true,
        isAgentRunning: false,
        canSubmit: true,
        queueMessage,
        submitMessage,
        getDraftRevision: () => 0,
        recovery: new FailedPreparationRecovery().forScope("test"),
        clearDraft,
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
      }),
    ).resolves.toBe("submitted");

    expect(queueMessage).not.toHaveBeenCalled();
    expect(submitMessage).toHaveBeenCalledWith({
      message: "",
      attachments: [],
    });
    expect(clearDraft).toHaveBeenCalledWith("sent");
  });
});

it("preserves draft and attachments until durable queue acceptance and on storage failure", async () => {
  let rejectWrite!: (error: Error) => void;
  const pending = new Promise<void>((_, reject) => {
    rejectWrite = reject;
  });
  const setUserInput = vi.fn();
  const setAttachments = vi.fn();
  const setSendError = vi.fn();
  const result = submitAgentInput({
    message: "saved draft",
    attachments: [{ id: "image" }],
    isAgentRunning: true,
    canSubmit: true,
    queueMessage: () => pending,
    submitMessage: async () => {},
    getDraftRevision: () => 0,
    recovery: new FailedPreparationRecovery().forScope("test"),
    clearDraft: vi.fn(),
    setUserInput,
    setAttachments,
    setSendError,
    setIsProcessing: vi.fn(),
  });
  expect(setUserInput).not.toHaveBeenCalled();
  expect(setAttachments).not.toHaveBeenCalled();
  rejectWrite(new Error("storage full"));
  expect(await result).toBe("failed");
  expect(setUserInput).not.toHaveBeenCalled();
  expect(setAttachments).not.toHaveBeenCalled();
  expect(setSendError).toHaveBeenCalledWith("storage full");
});

it("keeps a preserve-and-lock draft untouched when preparation fails", async () => {
  const pending = createDeferredPromise<void>();
  const clearDraft = vi.fn();
  const setUserInput = vi.fn();
  const setAttachments = vi.fn();
  const result = submitAgentInput({
    message: "original",
    attachments: [{ id: "original" }],
    submitBehavior: "preserve-and-lock",
    isAgentRunning: false,
    canSubmit: true,
    getDraftRevision: () => 0,
    recovery: new FailedPreparationRecovery().forScope("test"),
    queueMessage: vi.fn(),
    submitMessage: () => pending.promise,
    clearDraft,
    setUserInput,
    setAttachments,
    setSendError: vi.fn(),
    setIsProcessing: vi.fn(),
  });
  expect(setUserInput).not.toHaveBeenCalled();
  expect(setAttachments).not.toHaveBeenCalled();
  pending.reject(new Error("save failed"));
  expect(await result).toBe("failed");
  expect(clearDraft).not.toHaveBeenCalled();
  expect(setUserInput).not.toHaveBeenCalled();
  expect(setAttachments).not.toHaveBeenCalled();
});

describe("failed preparation recovery ownership", () => {
  it("keeps the exact submitted snapshot when a newer draft survives a failed preparation", async () => {
    let retained = 0;
    const recovery = new FailedPreparationRecovery<{ id: string }>(() => {
      retained += 1;
      return () => {
        retained -= 1;
      };
    });
    const pending = createDeferredPromise<void>();
    let text = "  original A\n";
    let attachments = [{ id: "A-image" }];
    let revision = 0;
    const originalAttachments = attachments;
    const result = submitAgentInput({
      message: text,
      attachments,
      isAgentRunning: false,
      canSubmit: true,
      getDraftRevision: () => revision,
      recovery: recovery.forScope("agent"),
      submitMessage: () => pending.promise,
      queueMessage: () => {},
      clearDraft: () => {
        text = "";
        attachments = [];
        revision += 1;
      },
      setUserInput: (value) => {
        text = value;
        revision += 1;
      },
      setAttachments: (value) => {
        attachments = value;
        revision += 1;
      },
      setSendError: () => {},
      setIsProcessing: () => {},
    });
    expect(retained).toBe(1);
    text = "B";
    attachments = [{ id: "B-image" }];
    revision += 1;
    pending.reject(new Error("device full"));
    expect(await result).toBe("failed");
    expect(text).toBe("B");
    expect(attachments).toEqual([{ id: "B-image" }]);
    const [copy] = recovery.getSnapshot();
    expect(copy.message).toBe("  original A\n");
    expect(copy.attachments).toEqual(originalAttachments);
    expect(copy.attachments[0]).toBe(originalAttachments[0]);
    expect(retained).toBe(1);
    await expect(
      recovery.restore(copy.id, () => {
        throw new Error("destination unavailable");
      }),
    ).rejects.toThrow("destination unavailable");
    expect(recovery.getSnapshot()).toHaveLength(1);
    expect(retained).toBe(1);
    const restored = createDeferredPromise<void>();
    const applied: string[] = [];
    const restoring = recovery.restore(copy.id, async (snapshot) => {
      await restored.promise;
      applied.push(snapshot.message);
    });
    recovery.discard(copy.id);
    expect(recovery.getSnapshot()).toHaveLength(1);
    expect(retained).toBe(1);
    restored.resolve();
    await restoring;
    expect(applied).toEqual(["  original A\n"]);
    expect(recovery.getSnapshot()).toEqual([]);
    expect(retained).toBe(0);
    expect(text).toBe("B");
    expect(attachments).toEqual([{ id: "B-image" }]);
  });

  it("does not keep successful or restored unchanged submissions as failed copies", async () => {
    const recovery = new FailedPreparationRecovery<string>();
    let revision = 0;
    const run = (submitMessage: () => Promise<void>) =>
      submitAgentInput({
        message: "original",
        attachments: ["image"],
        isAgentRunning: false,
        canSubmit: true,
        getDraftRevision: () => revision,
        recovery: recovery.forScope("agent"),
        queueMessage: () => {},
        submitMessage,
        clearDraft: () => {
          revision += 1;
        },
        setUserInput: () => {
          revision += 1;
        },
        setAttachments: () => {
          revision += 1;
        },
        setSendError: () => {},
        setIsProcessing: () => {},
      });
    expect(await run(async () => {})).toBe("submitted");
    expect(recovery.getSnapshot()).toEqual([]);
    expect(
      await run(async () => {
        throw new Error("encode failed");
      }),
    ).toBe("failed");
    expect(recovery.getSnapshot()).toEqual([]);
  });

  it("keeps submitted queue content when a newer draft replaces it before a failed save", async () => {
    const recovery = new FailedPreparationRecovery<string>();
    const pending = createDeferredPromise<void>();
    let revision = 0;
    const queued = submitAgentInput({
      message: "A",
      attachments: ["A-image"],
      isAgentRunning: true,
      canSubmit: true,
      getDraftRevision: () => revision,
      recovery: recovery.forScope("agent"),
      queueMessage: () => pending.promise,
      submitMessage: async () => {},
      clearDraft: () => {},
      setUserInput: () => {},
      setAttachments: () => {},
      setSendError: () => {},
      setIsProcessing: () => {},
    });
    revision += 1;
    pending.reject(new Error("queue save failed"));
    expect(await queued).toBe("failed");
    expect(recovery.getSnapshot()).toEqual([
      expect.objectContaining({ message: "A", attachments: ["A-image"] }),
    ]);
    recovery.discard(recovery.getSnapshot()[0].id);
    expect(recovery.getSnapshot()).toEqual([]);
  });
});
