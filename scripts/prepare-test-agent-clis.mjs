import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Exact releases and their native optional packages were published by 2026-10-15.
// Keep provider-test prerequisites independent of the runner's global installs.
const packages = ["@anthropic-ai/claude-code@2.1.301", "opencode-ai@1.14.46"];
if (process.argv.includes("--codex")) packages.push("@openai/codex@0.105.0");
if (process.argv.slice(2).some((argument) => argument !== "--codex")) {
  throw new Error("Supported argument: --codex");
}
if (process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP || !process.env.GITHUB_PATH) {
  throw new Error("Test agent CLI setup requires an isolated GitHub Actions runner");
}
const prefix = path.join(process.env.RUNNER_TEMP, "paseo-test-agent-clis");
mkdirSync(prefix, { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, [
  "scripts/npm-retry.mjs",
  "install",
  "--prefix",
  prefix,
  "--no-audit",
  "--no-fund",
  "--package-lock=false",
  "--save-exact",
  "--ignore-scripts",
  ...packages,
]);
// This inspected script only places the exact installed optional native binary.
run(process.execPath, [path.join(prefix, "node_modules/@anthropic-ai/claude-code/install.cjs")]);
run(path.join(prefix, "node_modules/@anthropic-ai/claude-code/bin/claude.exe"), ["--version"]);
run(process.execPath, [path.join(prefix, "node_modules/opencode-ai/bin/opencode"), "--version"]);
if (process.argv.includes("--codex")) {
  run(process.execPath, [
    path.join(prefix, "node_modules/@openai/codex/bin/codex.js"),
    "--version",
  ]);
}
appendFileSync(process.env.GITHUB_PATH, `${path.join(prefix, "node_modules/.bin")}\n`);
console.log(JSON.stringify({ prefix, packages, global: false, lockfile: false }));
