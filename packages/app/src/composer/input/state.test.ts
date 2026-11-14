import { describe, expect, it, vi } from "vitest";
import {
  applyDictationTranscript,
  computeCanStartDictation,
  queueInputMessage,
  resolveActiveSendBehavior,
  resolveDirectActiveTurnBehavior,
  resolveComposerSurfacePresentation,
  runAlternateSendAction,
  runDefaultSendAction,
  runMessageInputKeyboardAction,
  stopRealtimeVoice,
} from "./state";

const connected = { isConnected: true } as never;
const disconnected = { isConnected: false } as never;

function createDictationKeyboard({ startsRecording }: { startsRecording: boolean }) {
  let isRecording = false;
  const actions: string[] = [];

  return {
    actions,
    pressDictationShortcut: () =>
      runMessageInputKeyboardAction("dictation-toggle", {
        focusInput: () => undefined,
        isDictationRecording: () => isRecording,
        markTranscriptForSend: () => actions.push("send transcript"),
        startDictation: () => {
          actions.push("start");
          isRecording = startsRecording;
        },
        confirmDictation: () => {
          actions.push("confirm");
          isRecording = false;
        },
        cancelDictation: () => undefined,
        toggleRealtimeVoice: () => undefined,
        isRealtimeVoiceActive: false,
        toggleRealtimeVoiceMute: () => undefined,
      }),
  };
}

describe("composer surface presentation", () => {
  it("shows only the input when no voice overlay is active", () => {
    expect(resolveComposerSurfacePresentation(false)).toEqual({
      input: { opacity: 1, pointerEvents: "auto" },
      overlay: { opacity: 0, pointerEvents: "none" },
    });
  });

  it("shows only the voice overlay while voice UI is active", () => {
    expect(resolveComposerSurfacePresentation(true)).toEqual({
      input: { opacity: 0, pointerEvents: "none" },
      overlay: { opacity: 1, pointerEvents: "auto" },
    });
  });
});

describe("computeCanStartDictation", () => {
  it("returns false when socket is disconnected", () => {
    expect(
      computeCanStartDictation({
        client: disconnected,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns false when isReadyForDictation is explicitly false", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: false,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns true when connected and ready", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(true);
  });

  it("falls back to socket connected state when isReadyForDictation is undefined", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: undefined,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(true);

    expect(
      computeCanStartDictation({
        client: disconnected,
        isReadyForDictation: undefined,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns false when the input is disabled", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: true,
        disabled: true,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns false when a dictation unavailable message is present", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: "Microphone unavailable",
      }),
    ).toBe(false);
  });

  it("returns false when client is null", () => {
    expect(
      computeCanStartDictation({
        client: null,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });
});

describe("dictation keyboard behavior", () => {
  it("starts dictation again after the previous dictation finishes", () => {
    const keyboard = createDictationKeyboard({ startsRecording: true });

    keyboard.pressDictationShortcut();
    keyboard.pressDictationShortcut();
    keyboard.pressDictationShortcut();

    expect(keyboard.actions).toEqual(["start", "send transcript", "confirm", "start"]);
  });

  it("can retry when starting dictation does not enter the recording state", () => {
    const keyboard = createDictationKeyboard({ startsRecording: false });

    keyboard.pressDictationShortcut();
    keyboard.pressDictationShortcut();

    expect(keyboard.actions).toEqual(["start", "start"]);
  });
});

describe("dictation transcript behavior", () => {
  it("publishes an auto-sent transcript to the composer before submitting it", () => {
    const actions: string[] = [];

    applyDictationTranscript("spoken prompt", {
      value: "typed context",
      defaultSendBehavior: "interrupt",
      isAgentRunning: false,
      onQueue: undefined,
      replaceText: (text) => actions.push(`replace:${text}`),
      onSubmit: (payload) => actions.push(`submit:${payload.text}`),
      attachments: [],
      cwd: "/repo",
      autoSend: true,
      getDraftRevision: () => 0,
    });

    expect(actions).toEqual([
      "replace:typed context spoken prompt",
      "submit:typed context spoken prompt",
    ]);
  });
});

describe("composer send behavior", () => {
  it("lets the daemon queue a turn that starts just as Queue mode sends", () => {
    expect(resolveDirectActiveTurnBehavior("queue")).toBeUndefined();
    expect(resolveDirectActiveTurnBehavior("queue", "steer_only")).toBe("steer_only");
    expect(resolveDirectActiveTurnBehavior("steer")).toBe("steer_only");
  });

  it("sends immediately when queue mode cannot advance past a permission", () => {
    expect(resolveActiveSendBehavior("queue", true)).toBe("steer");
    expect(resolveActiveSendBehavior("queue", false)).toBe("queue");
    expect(resolveActiveSendBehavior("steer", true)).toBe("steer");
  });

  function actions() {
    const calls: string[] = [];
    return {
      calls,
      handleSendMessage: (behavior?: "interrupt" | "steer" | "steer_only") =>
        calls.push(behavior ? `send:${behavior}` : "send"),
      handleQueueMessage: () => calls.push("queue"),
      onQueue: () => undefined,
    };
  }

  it("uses Enter to interrupt and Mod+Enter to queue when interrupt is selected", () => {
    const defaultAction = actions();
    runDefaultSendAction({
      defaultSendBehavior: "interrupt",
      isAgentRunning: true,
      onQueue: defaultAction.onQueue,
      handleSendMessage: defaultAction.handleSendMessage,
      handleQueueMessage: defaultAction.handleQueueMessage,
    });

    const alternateAction = actions();
    runAlternateSendAction({
      defaultSendBehavior: "interrupt",
      isAgentRunning: true,
      onQueue: alternateAction.onQueue,
      handleSendMessage: alternateAction.handleSendMessage,
      handleQueueMessage: alternateAction.handleQueueMessage,
    });

    expect(defaultAction.calls).toEqual(["send:interrupt"]);
    expect(alternateAction.calls).toEqual(["queue"]);
  });

  it("uses Enter to steer and Mod+Enter to queue when steer is selected", () => {
    const defaultAction = actions();
    runDefaultSendAction({
      defaultSendBehavior: "steer",
      isAgentRunning: true,
      onQueue: defaultAction.onQueue,
      handleSendMessage: defaultAction.handleSendMessage,
      handleQueueMessage: defaultAction.handleQueueMessage,
    });

    const alternateAction = actions();
    runAlternateSendAction({
      defaultSendBehavior: "steer",
      isAgentRunning: true,
      onQueue: alternateAction.onQueue,
      handleSendMessage: alternateAction.handleSendMessage,
      handleQueueMessage: alternateAction.handleQueueMessage,
    });

    expect(defaultAction.calls).toEqual(["send:steer_only"]);
    expect(alternateAction.calls).toEqual(["queue"]);
  });

  it("uses Enter to queue and Mod+Enter to steer when queue is selected", () => {
    const defaultAction = actions();
    runDefaultSendAction({
      defaultSendBehavior: "queue",
      isAgentRunning: true,
      onQueue: defaultAction.onQueue,
      handleSendMessage: defaultAction.handleSendMessage,
      handleQueueMessage: defaultAction.handleQueueMessage,
    });

    const alternateAction = actions();
    runAlternateSendAction({
      defaultSendBehavior: "queue",
      isAgentRunning: true,
      onQueue: alternateAction.onQueue,
      handleSendMessage: alternateAction.handleSendMessage,
      handleQueueMessage: alternateAction.handleQueueMessage,
    });

    expect(defaultAction.calls).toEqual(["queue"]);
    expect(alternateAction.calls).toEqual(["send:steer_only"]);
  });
});

describe("stopRealtimeVoice", () => {
  it("stops voice mode without cancelling the running agent", async () => {
    const cancelAgent = vi.fn().mockResolvedValue(undefined);
    const stopVoice = vi.fn().mockResolvedValue(undefined);

    await stopRealtimeVoice({
      voice: { stopVoice },
      isRealtimeVoiceForCurrentAgent: true,
      isAgentRunning: true,
      client: { cancelAgent },
      voiceAgentId: "agent-1",
    });

    expect(stopVoice).toHaveBeenCalled();
    expect(cancelAgent).not.toHaveBeenCalled();
  });
});

it("awaits the widget queue callback without clearing newer input", async () => {
  const { queueInputMessage } = await import("./state");
  let resolve!: () => void;
  let current = "submitted";
  let revision = 0;
  const write = new Promise<void>((accept) => {
    resolve = accept;
  });
  const queued = queueInputMessage({ text: current, attachments: [], cwd: "/repo" }, () => write, {
    getDraftRevision: () => revision,
    clearDraft: () => {
      current = "";
    },
  });
  expect(current).toBe("submitted");
  current = "newer edit";
  revision += 1;
  resolve();
  await queued;
  expect(current).toBe("newer edit");
});

it("retains auto-queued dictation after local acceptance fails", async () => {
  let current = "draft";
  applyDictationTranscript("spoken", {
    value: current,
    defaultSendBehavior: "queue",
    isAgentRunning: true,
    onQueue: async () => {
      throw new Error("storage full");
    },
    onSubmit: () => {},
    replaceText: (text) => {
      current = text;
    },
    attachments: [],
    cwd: "/repo",
    autoSend: true,
    getDraftRevision: () => 0,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(current).toBe("draft spoken");
});

function createQueuedField() {
  let text = "A";
  let revision = 0;
  return {
    getText: () => text,
    getDraftRevision: () => revision,
    edit: (next: string) => {
      text = next;
      revision += 1;
    },
    editAttachments: () => {
      revision += 1;
    },
    clearDraft: () => {
      text = "";
      revision += 1;
    },
  };
}

function pendingQueueWrite() {
  let resolve!: (result?: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void | boolean>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

describe("widget Queue settlement", () => {
  it("clears only after an unchanged draft is accepted", async () => {
    const field = createQueuedField();
    const write = pendingQueueWrite();
    const queued = queueInputMessage(
      { text: "A", attachments: [], cwd: "/repo" },
      () => write.promise,
      field,
    );
    expect(field.getText()).toBe("A");
    write.resolve();
    expect(await queued).toBe(true);
    expect(field.getText()).toBe("");
  });

  it("keeps A after A to B to A edits before acceptance", async () => {
    const field = createQueuedField();
    const write = pendingQueueWrite();
    const queued = queueInputMessage(
      { text: "A", attachments: [], cwd: "/repo" },
      () => write.promise,
      field,
    );
    field.edit("B");
    field.edit("A");
    write.resolve();
    expect(await queued).toBe(true);
    expect(field.getText()).toBe("A");
  });

  it("keeps text when only attachments change before acceptance", async () => {
    const field = createQueuedField();
    const write = pendingQueueWrite();
    const queued = queueInputMessage(
      { text: "A", attachments: [], cwd: "/repo" },
      () => write.promise,
      field,
    );
    field.editAttachments();
    write.resolve();
    expect(await queued).toBe(true);
    expect(field.getText()).toBe("A");
  });

  it("keeps an unchanged draft when the queue callback declines it", async () => {
    const field = createQueuedField();
    expect(
      await queueInputMessage({ text: "A", attachments: [], cwd: "/repo" }, () => false, field),
    ).toBe(false);
    expect(field.getText()).toBe("A");
  });

  it("keeps an unchanged draft when acceptance fails", async () => {
    const field = createQueuedField();
    const write = pendingQueueWrite();
    const queued = queueInputMessage(
      { text: "A", attachments: [], cwd: "/repo" },
      () => write.promise,
      field,
    );
    write.reject(new Error("device save failed"));
    await expect(queued).rejects.toThrow("device save failed");
    expect(field.getText()).toBe("A");
  });

  it("keeps an unchanged draft when keepComposer is requested", async () => {
    const field = createQueuedField();
    expect(
      await queueInputMessage({ text: "A", attachments: [], cwd: "/repo" }, () => true, {
        ...field,
        keepComposer: true,
      }),
    ).toBe(true);
    expect(field.getText()).toBe("A");
  });
});

it("keeps edits that re-enter an auto-queued transcript before acceptance", async () => {
  const field = createQueuedField();
  const write = pendingQueueWrite();
  applyDictationTranscript("spoken", {
    value: field.getText(),
    defaultSendBehavior: "queue",
    isAgentRunning: true,
    onQueue: () => write.promise.then(() => {}),
    onSubmit: () => {},
    replaceText: field.edit,
    getDraftRevision: field.getDraftRevision,
    attachments: [],
    cwd: "/repo",
    autoSend: true,
  });
  expect(field.getText()).toBe("A spoken");
  field.edit("B");
  field.edit("A spoken");
  write.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(field.getText()).toBe("A spoken");
});
