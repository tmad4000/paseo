import { expect, test } from "vitest";
import { createPlaybackQueue } from "./playback";

function harness() {
  const started: string[] = [];
  const finishes: (() => void)[] = [];
  const queue = createPlaybackQueue<string>((source, signal) => {
    started.push(source);
    return new Promise<number>((resolve, reject) => {
      finishes.push(() => resolve(1));
      signal.addEventListener("abort", () => reject(new Error("Playback stopped")), { once: true });
    });
  });
  return { queue, started, finishes };
}

test("plays in order and resolves only after playback completes", async () => {
  const h = harness();
  const first = h.queue.play("first");
  const second = h.queue.play("second");
  expect(h.started).toEqual(["first"]);
  h.finishes[0]();
  await expect(first).resolves.toBe(1);
  expect(h.started).toEqual(["first", "second"]);
  h.finishes[1]();
  await expect(second).resolves.toBe(1);
});

test("cancels one owner's queued and active work without stopping another owner", async () => {
  const h = harness();
  const owner = new AbortController();
  const first = h.queue.play("first", owner.signal);
  const queued = h.queue.play("cancelled", owner.signal);
  const other = h.queue.play("other");
  const rejected = Promise.all([
    expect(first).rejects.toThrow("Playback stopped"),
    expect(queued).rejects.toThrow("Playback stopped"),
  ]);
  owner.abort(new Error("unloaded"));
  await rejected;
  expect(h.started).toEqual(["first", "other"]);
  h.finishes[1]();
  await expect(other).resolves.toBe(1);
});

test("stop during loading cannot start cancelled audio or strand the next call", async () => {
  const h = harness();
  const first = h.queue.play("loading");
  const rejected = expect(first).rejects.toThrow("Playback stopped");
  h.queue.stop();
  await rejected;
  const second = h.queue.play("next");
  h.finishes[1]();
  await expect(second).resolves.toBe(1);
});

test("a failed file does not block the queue", async () => {
  const queue = createPlaybackQueue<string>(async (source) => {
    if (source === "invalid") throw new Error("Invalid audio");
    return 2;
  });
  const failed = queue.play("invalid");
  const next = queue.play("valid");
  await expect(failed).rejects.toThrow("Invalid audio");
  await expect(next).resolves.toBe(2);
});

test("cancelling a source still loading releases the next owner's audio", async () => {
  const loading = new Promise<number>(() => {});
  const queue = createPlaybackQueue<string>((source) =>
    source === "loading" ? loading : Promise.resolve(2),
  );
  const first = queue.play("loading");
  const rejected = expect(first).rejects.toThrow("Playback stopped");
  queue.stop();
  await rejected;
  await expect(queue.play("next")).resolves.toBe(2);
  queue.destroy();
});

test("ending the voice waiting cue leaves a plugin's active audio playing", async () => {
  const { createVoiceRuntime } = await import("../voice/voice-runtime");
  let finishPlugin!: () => void;
  let cueQueued!: () => void;
  const queued = new Promise<void>((resolve) => {
    cueQueued = resolve;
  });
  const output = createPlaybackQueue<{ type: string }>(
    (_source, signal) =>
      new Promise((resolve, reject) => {
        finishPlugin = () => resolve(1);
        signal.addEventListener("abort", () => reject(new Error("Playback stopped")), {
          once: true,
        });
      }),
  );
  const engine = {
    initialize: async () => {},
    destroy: async () => {
      output.destroy();
    },
    startCapture: async () => {},
    stopCapture: async () => {},
    toggleMute: () => false,
    isMuted: () => false,
    play(source: { type: string }, signal?: AbortSignal) {
      if (source.type.startsWith("audio/pcm")) cueQueued();
      return output.play(source, signal);
    },
    stop: output.stop,
    clearQueue: output.clearQueue,
    isPlaying: output.isPlaying,
  };
  const runtime = createVoiceRuntime({
    engine,
    getServerInfo: () => ({
      serverId: "host",
      hostname: "host",
      version: "1.0.0",
      capabilities: {
        voice: { dictation: { enabled: true, reason: "" }, voice: { enabled: true, reason: "" } },
      },
    }),
    activateKeepAwake: async () => {},
    deactivateKeepAwake: async () => {},
  });
  runtime.registerSession({
    serverId: "host",
    setVoiceMode: async () => ({}),
    setVoiceInputMuted: async (muted) => muted,
    readVoiceInputReceipts: async () => ({ items: [], nextCursor: null }),
    sendVoiceAudioChunk: async () => {},
    audioPlayed: async () => {},
    abortRequest: async () => {},
    setAssistantAudioPlaying: () => {},
  });
  try {
    await runtime.startVoice("host", "agent");
    const result = engine.play({ type: "audio/wav" }).then(
      () => "finished",
      () => "stopped",
    );
    runtime.onTurnEvent("host", "agent", "turn_started");
    await queued;
    runtime.onAssistantAudioStarted("host");
    finishPlugin();
    expect(await result).toBe("finished");
  } finally {
    await runtime.destroy();
  }
});

test.each(["stop", "disconnect"] as const)(
  "voice %s leaves another host plugin audio active and queued",
  async (action) => {
    const { createVoiceRuntime } = await import("../voice/voice-runtime");
    const startedSources: string[] = [];
    let finishPlugin!: () => void;
    let nextStarted!: () => void;
    const nextReady = new Promise<void>((resolve) => {
      nextStarted = resolve;
    });
    let cueQueued!: () => void;
    const queued = new Promise<void>((resolve) => {
      cueQueued = resolve;
    });
    const output = createPlaybackQueue<{ type: string }>(
      (source, signal) =>
        new Promise((resolve, reject) => {
          startedSources.push(source.type);
          finishPlugin = () => resolve(1);
          if (source.type === "audio/ogg") nextStarted();
          signal.addEventListener("abort", () => reject(new Error("Playback stopped")), {
            once: true,
          });
        }),
    );
    const engine = {
      initialize: async () => {},
      destroy: async () => {
        output.destroy();
      },
      startCapture: async () => {},
      stopCapture: async () => {},
      toggleMute: () => false,
      isMuted: () => false,
      play(source: { type: string }, signal?: AbortSignal) {
        if (source.type.startsWith("audio/pcm")) cueQueued();
        return output.play(source, signal);
      },
      stop: output.stop,
      clearQueue: output.clearQueue,
      isPlaying: output.isPlaying,
    };
    const runtime = createVoiceRuntime({
      engine,
      getServerInfo: () => ({
        serverId: "host",
        hostname: "host",
        version: "1.0.0",
        capabilities: {
          voice: { dictation: { enabled: true, reason: "" }, voice: { enabled: true, reason: "" } },
        },
      }),
      activateKeepAwake: async () => {},
      deactivateKeepAwake: async () => {},
    });
    runtime.registerSession({
      serverId: "host",
      setVoiceMode: async () => ({}),
      setVoiceInputMuted: async (muted) => muted,
      readVoiceInputReceipts: async () => ({ items: [], nextCursor: null }),
      sendVoiceAudioChunk: async () => {},
      audioPlayed: async () => {},
      abortRequest: async () => {},
      setAssistantAudioPlaying: () => {},
    });
    try {
      await runtime.startVoice("host", "agent");
      const result = engine.play({ type: "audio/wav" }).then(
        () => "finished",
        () => "stopped",
      );
      runtime.onTurnEvent("host", "agent", "turn_started");
      await queued;
      const next = engine.play({ type: "audio/ogg" }).then(
        () => "finished",
        () => "stopped",
      );
      runtime.onInputMutedChanged("host", true);
      if (action === "stop") await runtime.stopVoice();
      else runtime.updateSessionConnection("host", false);
      finishPlugin();
      expect(await result).toBe("finished");
      await nextReady;
      finishPlugin();
      expect(await next).toBe("finished");
      expect(startedSources).not.toContain("audio/pcm;rate=24000;bits=16");
    } finally {
      await runtime.destroy();
    }
  },
);
