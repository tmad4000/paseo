import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { PASEO_BROWSER_PROFILE_PARTITION } from "./features/browser-profile.js";

// The preload runs inside Electron's sandbox and is tsc-compiled (not bundled), so at
// runtime it may only load Electron's sandbox allowlist. Any other module (local or
// third-party) emits a require() that the sandbox rejects synchronously, aborting the
// preload before contextBridge.exposeInMainWorld runs and leaving window.paseoDesktop
// undefined. That regression (0.1.108, #2103) is what this test guards against.
const SANDBOX_ALLOWLIST = new Set(["electron"]);

const preloadPath = join(dirname(fileURLToPath(import.meta.url)), "preload.ts");

function executePreload() {
  const exposed: Record<string, unknown> = {};
  const invoke = vi.fn().mockResolvedValue(undefined);
  const runtimeLoads: string[] = [];
  const emitted = ts.transpileModule(readFileSync(preloadPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(emitted, {
    exports: {},
    process: { argv: [], platform: "darwin" },
    require: (name: string) => {
      runtimeLoads.push(name);
      if (!SANDBOX_ALLOWLIST.has(name)) throw new Error("Unexpected runtime module: " + name);
      return {
        contextBridge: {
          exposeInMainWorld: (bridgeName: string, bridge: unknown) => {
            exposed[bridgeName] = bridge;
          },
        },
        ipcRenderer: { invoke },
        webUtils: {},
      };
    },
  });
  const bridge = exposed.paseoDesktop as {
    browser: { profilePartition: string };
    window: {
      supportsAgentTarget: boolean;
      openNew: (options: { agent: { serverId: string; agentId: string } }) => Promise<void>;
    };
  };
  return { bridge, invoke, runtimeLoads };
}

describe("preload sandbox safety", () => {
  it("only loads Electron's sandbox allowlist at runtime and exposes the bridge", () => {
    const { bridge, runtimeLoads } = executePreload();
    expect(runtimeLoads).toEqual(["electron"]);
    expect(bridge).toBeDefined();
  });

  it("exposes the browser profile partition used by desktop browser sessions", () => {
    const { bridge } = executePreload();
    expect(bridge.browser.profilePartition).toBe(PASEO_BROWSER_PROFILE_PARTITION);
  });
});

it("advertises and forwards agent-targeted windows through the actual exposed preload bridge", async () => {
  const { bridge, invoke } = executePreload();
  expect(bridge.window.supportsAgentTarget).toBe(true);
  const agent = { serverId: "saved-host", agentId: "linked-agent" };
  await bridge.window.openNew({ agent });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("paseo:window:openNew", { agent });
});
