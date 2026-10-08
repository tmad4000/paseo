import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { OpenAiRealtime, type RealtimeSocket } from "./openai-realtime.js";
import { RealtimeContextStore } from "./realtime-context.js";

class Socket extends EventEmitter implements RealtimeSocket {
  sent: Record<string, unknown>[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  event(data: object) {
    this.emit("message", JSON.stringify(data));
  }
}
const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
async function fixture() {
  const directory = mkdtempSync(join(process.cwd(), ".realtime-test-"));
  dirs.push(directory);
  const store = new RealtimeContextStore(directory, "11111111-1111-4111-8111-111111111111");
  const socket = new Socket();
  const host = {
    status: vi.fn(),
    speech: vi.fn(),
    audio: vi.fn(),
    stopPlayback: vi.fn(),
    submit: vi.fn().mockResolvedValue(undefined),
    endVoice: vi.fn(),
  };
  const voice = new OpenAiRealtime({ store, host, key: () => "test-key", connect: () => socket });
  const started = voice.start();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  socket.emit("open");
  socket.event({ type: "session.updated" });
  await started;
  async function settle() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }
  async function transcript(id: string, text: string) {
    socket.event({ type: "input_audio_buffer.committed", item_id: id });
    socket.event({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: id,
      transcript: text,
    });
    await settle();
  }
  return { voice, host, socket, store, settle, transcript };
}
describe("GPT Realtime attachment", () => {
  it("collects long listening without replies or dispatch across silence", async () => {
    const f = await fixture();
    f.voice.listen();
    for (let i = 0; i < 20; i++) await f.transcript(`part-${i}`, `Paragraph ${i}`);
    expect(f.host.submit).not.toHaveBeenCalled();
    expect(f.socket.sent.filter((x) => x.type === "response.create")).toHaveLength(0);
    f.voice.endListening();
    await f.settle();
    expect(f.host.submit).toHaveBeenCalledTimes(1);
    expect(f.host.submit.mock.calls[0][0]).toBe(
      Array.from({ length: 20 }, (_, i) => `Paragraph ${i}`).join("\n"),
    );
    f.voice.endListening();
    await f.settle();
    expect(f.host.submit).toHaveBeenCalledTimes(1);
    f.voice.stop();
  });
  it("waits for committed segments that transcribe out of order", async () => {
    const f = await fixture();
    f.voice.listen();
    for (const id of ["a", "b"])
      f.socket.event({ type: "input_audio_buffer.committed", item_id: id });
    f.socket.event({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "b",
      transcript: "second",
    });
    await f.settle();
    f.voice.endListening();
    await f.settle();
    expect(f.host.submit).not.toHaveBeenCalled();
    f.socket.event({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "a",
      transcript: "first",
    });
    await f.settle();
    expect(f.host.submit.mock.calls[0][0]).toBe("first\nsecond");
    f.voice.stop();
  });
  it("mute drops audio and retains the unsent draft on stop", async () => {
    const f = await fixture();
    f.voice.listen();
    await f.transcript("one", "keep this");
    f.voice.mute(true);
    const before = f.socket.sent.length;
    f.voice.append(Buffer.alloc(3200).toString("base64"), "audio/pcm;rate=16000;bits=16");
    expect(f.socket.sent).toHaveLength(before);
    f.voice.stop();
    expect(f.store.read().draft[0].text).toBe("keep this");
    expect(f.store.read().muted).toBe(true);
    expect(f.host.submit).not.toHaveBeenCalled();
  });
  it("rejects late events after end", async () => {
    const f = await fixture();
    f.voice.stop();
    await f.transcript("late", "launch work");
    expect(f.host.submit).not.toHaveBeenCalled();
    expect(f.host.audio).not.toHaveBeenCalled();
  });
  it("clear is idempotent, retains receipts and excludes old voice context", async () => {
    const f = await fixture();
    f.voice.listen();
    await f.transcript("a", "old private fact");
    const old = f.store.read();
    old.deliveries.accepted = "accepted";
    f.store.write(old);
    const next = f.store.clear(old.epoch, "request-1");
    expect(next.draft).toEqual([]);
    expect(next.entries).toEqual([]);
    expect(next.deliveries.accepted).toBe("accepted");
    expect(f.store.clear(old.epoch, "request-1").epoch).toBe(next.epoch);
    expect(() => f.store.clear(old.epoch, "request-2")).toThrow();
    expect(() => f.store.clear(next.epoch, "../../escape")).toThrow();
    f.voice.stop();
  });
  it("unknown delivery is not retried when explicit end is repeated", async () => {
    const f = await fixture();
    f.host.submit.mockRejectedValue(new Error("lost ack"));
    f.voice.listen();
    await f.transcript("one", "do work");
    await f.transcript("end", "end listening");
    await f.settle();
    expect(f.host.submit).toHaveBeenCalledTimes(1);
    expect(Object.values(f.store.read().deliveries)).toEqual(["unknown"]);
    f.voice.stop();
  });
  it("barge-in before response.created discards late speech and tool admission", async () => {
    const f = await fixture();
    await f.transcript("request", "make a change");
    f.socket.event({ type: "input_audio_buffer.speech_started" });
    f.socket.event({ type: "response.created", response: { id: "r1" } });
    f.socket.event({
      type: "response.output_audio.delta",
      response_id: "r1",
      item_id: "a1",
      delta: "AAAA",
    });
    f.socket.event({ type: "response.output_audio.done", response_id: "r1" });
    f.socket.event({
      type: "response.output_item.done",
      response_id: "r1",
      item: { id: "t1", type: "function_call", name: "send_to_agent", call_id: "c1" },
    });
    await f.settle();
    expect(f.host.stopPlayback).toHaveBeenCalled();
    expect(f.host.audio).not.toHaveBeenCalled();
    expect(f.host.submit).not.toHaveBeenCalled();
    f.voice.stop();
  });
  it("one bound tool call produces one queue admission and one tool result", async () => {
    const f = await fixture();
    await f.transcript("request", "make a change");
    f.socket.event({ type: "response.created", response: { id: "r1" } });
    const event = {
      type: "response.output_item.done",
      response_id: "r1",
      item: { id: "t1", type: "function_call", name: "send_to_agent", call_id: "c1" },
    };
    f.socket.event(event);
    f.socket.event(event);
    await f.settle();
    expect(f.host.submit).toHaveBeenCalledExactlyOnceWith("make a change", "request");
    expect(
      f.socket.sent.filter((x) => (x.item as { type?: string })?.type === "function_call_output"),
    ).toHaveLength(1);
    f.voice.stop();
  });
  it("delivers a nonempty final audio chunk and survives a benign cancel race", async () => {
    const f = await fixture();
    await f.transcript("request", "hello");
    f.socket.event({ type: "response.created", response: { id: "r1" } });
    f.socket.event({
      type: "response.output_audio.delta",
      response_id: "r1",
      item_id: "a1",
      delta: "AAAA",
    });
    f.socket.event({ type: "response.output_audio.done", response_id: "r1" });
    f.socket.event({ type: "error", error: { code: "response_cancel_not_active" } });
    await f.settle();
    expect(f.host.audio).toHaveBeenCalledExactlyOnceWith("r1", "AAAA", 0, true);
    expect(f.voice.status().connection).toBe("connected");
    f.voice.stop();
  });
  it("clear waits for an in-flight admission and never resurrects the old draft", async () => {
    const f = await fixture();
    let admitted!: () => void;
    f.host.submit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          admitted = resolve;
        }),
    );
    f.voice.listen();
    await f.transcript("one", "work");
    void f.voice.endListening();
    await f.settle();
    const clearing = f.voice.clear(f.voice.status().epoch, "clear-1");
    admitted();
    await f.settle();
    f.socket.emit("open");
    f.socket.event({ type: "session.updated" });
    await clearing;
    expect(f.store.read().entries).toEqual([]);
    expect(f.store.read().draft).toEqual([]);
    expect(Object.values(f.store.read().deliveries)).toEqual(["accepted"]);
    expect(f.host.submit).toHaveBeenCalledTimes(1);
    f.voice.stop();
  });
  it("disconnect pauses the microphone without retrying and resume restores context", async () => {
    const f = await fixture();
    f.voice.listen();
    await f.transcript("one", "saved draft");
    f.socket.emit("close");
    expect(f.voice.status()).toMatchObject({
      connection: "unavailable",
      muted: true,
      draft: "saved draft",
    });
    const restarting = f.voice.start(true);
    await f.settle();
    f.socket.emit("open");
    f.socket.event({ type: "session.updated" });
    await restarting;
    expect(f.voice.status()).toMatchObject({
      connection: "connected",
      muted: true,
      draft: "saved draft",
    });
    expect(f.host.submit).not.toHaveBeenCalled();
    f.voice.stop();
  });
  it("pins direct task delivery to finalized text, with assistant focus silent", async () => {
    const f = await fixture();
    f.voice.focus("agent");
    await f.transcript("one", "run the checks");
    expect(f.host.submit).toHaveBeenCalledExactlyOnceWith("run the checks", "one");
    f.voice.focus("assistant");
    await f.transcript("two", "hello");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
    f.voice.stop();
  });
  it("storage failure still publishes microphone-off and prevents admission", async () => {
    const f = await fixture();
    f.voice.listen();
    const write = vi.spyOn(f.store, "write").mockImplementation(() => {
      throw new Error("disk full");
    });
    await f.transcript("one", "do not lose this");
    expect(f.host.submit).not.toHaveBeenCalled();
    expect(f.host.status).toHaveBeenLastCalledWith(
      expect.objectContaining({
        muted: true,
        connection: "unavailable",
        error: expect.stringContaining("storage failed"),
      }),
    );
    write.mockRestore();
    f.voice.stop();
  });
  it("late admission after stop preserves newer attachment context and its receipt", async () => {
    const f = await fixture();
    let admitted!: () => void;
    f.host.submit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          admitted = resolve;
        }),
    );
    f.voice.listen();
    await f.transcript("old", "old request");
    void f.voice.endListening();
    await f.settle();
    f.voice.stop();
    const next = f.store.read();
    next.draft = [{ id: "new", role: "user", text: "new attachment draft" }];
    f.store.write(next);
    admitted();
    await f.settle();
    expect(f.store.read().draft).toEqual(next.draft);
    expect(Object.values(f.store.read().deliveries)).toEqual(["accepted"]);
    // A still-live attachment with an earlier snapshot also cannot regress the settled ledger.
    f.store.write(next);
    expect(Object.values(f.store.read().deliveries)).toEqual(["accepted"]);
    expect(f.host.submit).toHaveBeenCalledTimes(1);
  });
  it("commits a short final audio tail before sending a long-listening draft", async () => {
    const f = await fixture();
    f.voice.listen();
    await f.transcript("one", "first");
    f.voice.append(Buffer.alloc(640).toString("base64"), "audio/pcm;rate=16000;bits=16");
    void f.voice.endListening();
    await f.settle();
    expect(f.socket.sent.at(-1)?.type).toBe("input_audio_buffer.commit");
    expect(f.host.submit).not.toHaveBeenCalled();
    await f.transcript("tail", "last syllable");
    expect(f.host.submit).toHaveBeenCalledExactlyOnceWith(
      "first\nlast syllable",
      expect.any(String),
    );
    f.voice.stop();
  });
  it("mute before final transcription leaves the unsent draft unsent", async () => {
    const f = await fixture();
    f.voice.listen();
    await f.transcript("one", "keep this draft");
    f.socket.event({ type: "input_audio_buffer.committed", item_id: "pending" });
    await f.settle();
    const ending = f.voice.endListening();
    f.voice.mute(true);
    await ending;
    f.socket.event({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "pending",
      transcript: "not finalized before mute",
    });
    await f.settle();
    expect(f.host.submit).not.toHaveBeenCalled();
    expect(f.store.read().draft.map((entry) => entry.text)).toEqual(["keep this draft"]);
    expect(f.voice.status()).toMatchObject({ mode: "listen", muted: true });
    f.voice.stop();
  });
});
