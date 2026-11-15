import path from "node:path";
import { createRequire } from "node:module";
import { resolveCliShimPath } from "./path.js";
import os from "node:os";
import { app } from "electron";

export function getLocalBinDir(): string {
  return path.join(os.homedir(), ".local", "bin");
}

// This fork installs its CLI as `paseo-fork` so it can coexist with a stock
// Paseo install instead of overwriting ~/.local/bin/paseo.
const CLI_COMMAND_NAME = "paseo-fork";

export function getCliTargetPath(): string {
  const filename = process.platform === "win32" ? `${CLI_COMMAND_NAME}.cmd` : CLI_COMMAND_NAME;
  return path.join(getLocalBinDir(), filename);
}

export function getBundledCliShimPath(): string {
  return resolveCliShimPath({
    platform: process.platform,
    isPackaged: app.isPackaged,
    executablePath: app.getPath("exe"),
    commandName: CLI_COMMAND_NAME,
    resolveWorkspaceCli: () => createRequire(__filename).resolve("@getpaseo/cli/bin/paseo"),
  });
}
