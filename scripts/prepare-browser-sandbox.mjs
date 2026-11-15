import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const electronHelper = fileURLToPath(
  new URL("../node_modules/electron/dist/chrome-sandbox", import.meta.url),
);

function restoreElectronHelper(directory) {
  const backup = path.join(directory, "electron-helper-original");
  if (!lstatSync(backup, { throwIfNoEntry: false })) return;
  const current = lstatSync(electronHelper, { throwIfNoEntry: false });
  if (current) {
    assert(current.isSymbolicLink());
    assert.equal(readlinkSync(electronHelper), path.join(directory, "chrome-sandbox"));
    unlinkSync(electronHelper);
  }
  renameSync(backup, electronHelper);
}

if (process.argv.includes("--cleanup")) {
  const directory = process.env.PASEO_TEST_SANDBOX_DIR;
  if (directory) {
    assert.equal(path.dirname(directory), temporaryRoot);
    assert(path.basename(directory).startsWith(prefix));
    assert(/^[A-Za-z0-9]{6}$/.test(path.basename(directory).slice(prefix.length)));
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (info) {
      assert(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid());
      restoreElectronHelper(directory);
      rmSync(directory, { recursive: true, force: true });
    }
  }
} else {
  // Use the helper shipped with the lockfile-pinned Playwright browser installed
  // by this job. Hosted images can have a runner-writable /opt, so their helper
  // path is not a root-owned source boundary. This job already owns passwordless
  // sudo; its dependency cache is not a boundary against malicious job code.
  const { chromium } = await import("playwright");
  const source = path.join(path.dirname(chromium.executablePath()), "chrome_sandbox");
  const sourceInfo = lstatSync(source);
  assert(sourceInfo.isFile() && !sourceInfo.isSymbolicLink());
  assert.equal(sourceInfo.mode & 0o022, 0, "Sandbox helper must not be writable by other users");
  const bytes = readFileSync(source);
  assert(bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])));
  assert(process.env.GITHUB_ENV, "GITHUB_ENV is required");
  const directory = mkdtempSync(path.join(temporaryRoot, prefix));
  chmodSync(directory, 0o700);
  const helper = path.join(directory, "chrome-sandbox");
  try {
    const snapshot = path.join(directory, "source");
    writeFileSync(snapshot, bytes, { flag: "wx", mode: 0o700 });
    execFileSync(
      "/usr/bin/sudo",
      ["-n", "/usr/bin/install", "-o", "root", "-g", "root", "-m", "4755", snapshot, helper],
      { stdio: "inherit" },
    );
    const info = statSync(helper);
    assert(info.uid === 0 && (info.mode & 0o7777) === 0o4755);
    // Chromium prefers an adjacent chrome-sandbox over CHROME_DEVEL_SANDBOX.
    // Only this ephemeral job's npm installation is changed, and cleanup restores
    // its original helper. No shared dependency directory or /opt is modified.
    const electronInfo = lstatSync(electronHelper, { throwIfNoEntry: false });
    if (electronInfo) {
      assert(electronInfo.isFile() && !electronInfo.isSymbolicLink());
      assert.equal(electronInfo.uid, process.getuid());
      renameSync(electronHelper, path.join(directory, "electron-helper-original"));
      symlinkSync(helper, electronHelper);
    }
    appendFileSync(
      process.env.GITHUB_ENV,
      `CHROME_DEVEL_SANDBOX=${helper}\nPASEO_TEST_SANDBOX_DIR=${directory}\n`,
    );
    console.log(
      `Prepared job-private Chromium sandbox helper sha256=${createHash("sha256").update(bytes).digest("hex")}`,
    );
  } catch (error) {
    try {
      restoreElectronHelper(directory);
      rmSync(directory, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error("Sandbox helper cleanup failed:", cleanupError);
    }
    throw error;
  }
}
