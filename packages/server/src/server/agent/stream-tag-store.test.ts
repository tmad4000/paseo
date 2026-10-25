import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StreamTagStore, applyTagPin } from "./stream-tag-store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function store() {
  const dir = mkdtempSync(join(tmpdir(), "stream-tag-store-"));
  dirs.push(dir);
  return {
    file: join(dir, "stream-tags.json"),
    store: new StreamTagStore(join(dir, "stream-tags.json")),
  };
}

describe("StreamTagStore", () => {
  it("persists host-wide pins in order and serializes concurrent changes", async () => {
    const { file, store: tags } = store();
    expect(await tags.getPinnedTags()).toEqual([]);
    await Promise.all([tags.setPinned("#Ideas", true), tags.setPinned("quotes", true)]);
    expect(await tags.getPinnedTags()).toEqual(["ideas", "quotes"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      version: 1,
      pinnedTags: ["ideas", "quotes"],
    });
    expect(await tags.setPinned("ideas", false)).toEqual(["quotes"]);
  });

  it("reports an unreadable file instead of overwriting it", async () => {
    const { file, store: tags } = store();
    writeFileSync(file, JSON.stringify({ version: 9 }));
    await expect(tags.getPinnedTags()).rejects.toThrow("unreadable");
    await expect(tags.setPinned("x", true)).rejects.toThrow("unreadable");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 9 });
  });
});

describe("applyTagPin", () => {
  const full = Array.from({ length: 50 }, (_, index) => `t${index}`);
  it("is idempotent and validates tags", () => {
    expect(applyTagPin(["a"], "a", true)).toEqual(["a"]);
    expect(applyTagPin(["a"], "b", false)).toEqual(["a"]);
    expect(() => applyTagPin([], "1x", true)).toThrow();
    expect(() => applyTagPin(full, "new", true)).toThrow("at most 50");
  });
});
