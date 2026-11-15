import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

// A job-private copy enables Chromium's sandbox without changing the image or /opt.
// https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
assert(
  process.env.GITHUB_ACTIONS === "true" &&
    process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
    process.env.RUNNER_OS === "Linux",
  "Sandbox preparation is restricted to ephemeral GitHub-hosted Linux jobs",
);
assert(process.env.RUNNER_TEMP, "RUNNER_TEMP is required");
const temporaryRoot = realpathSync(process.env.RUNNER_TEMP);
assert(!/[\r\n]/.test(temporaryRoot));
const prefix = "paseo-browser-sandbox-";

if (process.argv.includes("--cleanup")) {
  const directory = process.env.PASEO_TEST_SANDBOX_DIR;
  if (directory) {
    assert.equal(path.dirname(directory), temporaryRoot);
    assert(path.basename(directory).startsWith(prefix));
    assert(/^[A-Za-z0-9]{6}$/.test(path.basename(directory).slice(prefix.length)));
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (info) {
      assert(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid());
      rmSync(directory, { recursive: true, force: true });
    }
  }
} else {
  const source = "/opt/google/chrome/chrome-sandbox";
  for (const entry of ["/opt", "/opt/google", "/opt/google/chrome", source]) {
    const info = lstatSync(entry);
    assert(
      !info.isSymbolicLink() && info.uid === 0 && (info.mode & 0o022) === 0,
      `Sandbox source must be root-owned and not writable by other users: ${entry}`,
    );
  }
  assert(statSync(source).isFile());
  assert(process.env.GITHUB_ENV, "GITHUB_ENV is required");
  const directory = mkdtempSync(path.join(temporaryRoot, prefix));
  chmodSync(directory, 0o700);
  const helper = path.join(directory, "chrome-sandbox");
  try {
    execFileSync(
      "/usr/bin/sudo",
      ["-n", "/usr/bin/install", "-o", "root", "-g", "root", "-m", "4755", source, helper],
      { stdio: "inherit" },
    );
    const info = statSync(helper);
    assert(info.uid === 0 && (info.mode & 0o7777) === 0o4755);
    appendFileSync(
      process.env.GITHUB_ENV,
      `CHROME_DEVEL_SANDBOX=${helper}\nPASEO_TEST_SANDBOX_DIR=${directory}\n`,
    );
    console.log("Prepared job-private Chromium sandbox helper");
  } catch (error) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error("Sandbox helper cleanup failed:", cleanupError);
    }
    throw error;
  }
}
