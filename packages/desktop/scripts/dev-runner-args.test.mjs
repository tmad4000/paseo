import { describe, expect, it } from "vitest";

import { resolveDevElectronArgs } from "./dev-runner-args.mjs";

describe("resolveDevElectronArgs", () => {
  it("keeps the Chromium process sandbox enabled for Linux development", () => {
    expect(resolveDevElectronArgs("linux", ["--remote-debugging-port=9223"])).toEqual([
      "--remote-debugging-port=9223",
    ]);
  });

  it.each(["darwin", "win32"])("preserves forwarded arguments on %s", (platform) => {
    expect(resolveDevElectronArgs(platform, ["--remote-debugging-port=9223"])).toEqual([
      "--remote-debugging-port=9223",
    ]);
  });
});
