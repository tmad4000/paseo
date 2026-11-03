import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { buildAudioPlaybackSource } from "./buffered-audio-source";

function chunk(index: number, bytes: number[], format: string) {
  return {
    id: `c-${index}`,
    chunkIndex: index,
    format,
    audio: Buffer.from(bytes).toString("base64"),
  };
}

describe("buildAudioPlaybackSource", () => {
  it("keeps a full GPT Realtime MIME type instead of prefixing audio/ again", () => {
    const source = buildAudioPlaybackSource([chunk(0, [1, 2], "audio/pcm;rate=24000;bits=16")]);
    expect(source.type).toBe("audio/pcm;rate=24000;bits=16");
  });

  it("maps short host TTS names", () => {
    expect(buildAudioPlaybackSource([chunk(0, [1], "mp3")]).type).toBe("audio/mpeg");
    expect(buildAudioPlaybackSource([chunk(0, [1], "pcm")]).type).toBe(
      "audio/pcm;rate=24000;bits=16",
    );
  });

  it("joins the chunks in order", async () => {
    const source = buildAudioPlaybackSource([chunk(0, [1, 2], "pcm"), chunk(1, [3], "pcm")]);
    expect(source.size).toBe(3);
    expect([...new Uint8Array(await source.arrayBuffer())]).toEqual([1, 2, 3]);
  });
});
