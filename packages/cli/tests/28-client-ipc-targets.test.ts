#!/usr/bin/env npx tsx

import assert from "node:assert";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getDaemonHost,
  normalizeDaemonHost,
  resolveDaemonPassword,
  resolveDaemonTarget,
} from "../src/utils/client.js";
import { selectDaemonTarget } from "../src/utils/daemon-target.js";
import {
  clearDefaultDaemonTarget,
  readDefaultDaemonTarget,
  saveDefaultDaemonTarget,
} from "../src/utils/client-target.js";
import { normalizeDefaultDaemonTarget } from "../src/commands/target.js";
import { resolveCliVersion } from "../src/version.js";

console.log("=== CLI IPC Target Helpers ===\n");

{
  console.log("Test 1: unix hosts resolve to ws+unix URLs");
  const target = resolveDaemonTarget("unix:///tmp/paseo.sock");
  assert.deepStrictEqual(target, {
    type: "ipc",
    url: "ws+unix:///tmp/paseo.sock:/ws",
    socketPath: "/tmp/paseo.sock",
  });
  console.log("✓ unix hosts resolve to ws+unix URLs\n");
}

{
  console.log("Test 1b: bare unix socket paths resolve at the connection boundary");
  const target = resolveDaemonTarget("/tmp/paseo.sock");
  assert.deepStrictEqual(target, {
    type: "ipc",
    url: "ws+unix:///tmp/paseo.sock:/ws",
    socketPath: "/tmp/paseo.sock",
  });
  console.log("✓ bare unix socket paths resolve at the connection boundary\n");
}

{
  console.log("Test 2: pipe hosts preserve the Node socketPath transport form");
  const target = resolveDaemonTarget("pipe://\\\\.\\pipe\\paseo-managed-test");
  assert.deepStrictEqual(target, {
    type: "ipc",
    url: "ws://localhost/ws",
    socketPath: "\\\\.\\pipe\\paseo-managed-test",
  });
  console.log("✓ pipe hosts preserve Node socketPath transport form\n");
}

{
  console.log("Test 3: tcp URI host targets honor ssl=true");
  const target = resolveDaemonTarget("tcp://example.com:6767?ssl=true&password=query-secret");
  assert.deepStrictEqual(target, {
    type: "tcp",
    url: "wss://example.com:6767/ws",
  });
  console.log("✓ tcp URI host targets honor ssl=true\n");
}

{
  console.log("Test 4: tcp URI hosts normalize into canonical direct TCP targets");
  assert.strictEqual(
    normalizeDaemonHost("tcp://Example.com:6767?ssl=true&password=query-secret"),
    "tcp://Example.com:6767?ssl=true&password=query-secret",
  );
  console.log("✓ tcp URI hosts normalize into canonical direct TCP targets\n");
}

{
  console.log("Test 5: local unix socket paths normalize into IPC daemon targets");
  assert.strictEqual(normalizeDaemonHost("/tmp/paseo.sock"), "unix:///tmp/paseo.sock");
  console.log("✓ local unix socket paths normalize into IPC daemon targets\n");
}

{
  console.log("Test 5b: Windows absolute paths are NOT treated as unix sockets");
  assert.strictEqual(normalizeDaemonHost("C:\\Users\\foo\\.paseo\\paseo.sock"), null);
  assert.strictEqual(normalizeDaemonHost("D:\\project\\socket"), null);
  console.log("✓ Windows absolute paths are not treated as unix sockets\n");
}

{
  const target = selectDaemonTarget(
    { home: "/tmp/selected-home" },
    { PASEO_HOST: "ignored:12345", PASEO_LISTEN: "ignored:23456" },
  );
  assert.deepStrictEqual(target, { kind: "instance", home: "/tmp/selected-home" });
  assert.strictEqual(getDaemonHost({ target }), "home /tmp/selected-home");
  assert.throws(() => selectDaemonTarget({}, { PASEO_HOME: "/tmp/a", PASEO_HOST: "unused:12345" }));
}

{
  console.log("Test 8: CLI app version resolves for daemon hello compatibility");
  assert.match(resolveCliVersion(), /^\d+\.\d+\.\d+/);
  console.log("✓ CLI app version resolves for daemon hello compatibility\n");
}

{
  console.log("Test 10: daemon password resolution prefers TCP URI query, falls back to env");
  const previousEnv = process.env.PASEO_PASSWORD;
  try {
    delete process.env.PASEO_PASSWORD;
    assert.strictEqual(
      resolveDaemonPassword("tcp://example.com:6767?ssl=true&password=query-secret"),
      "query-secret",
    );
    assert.strictEqual(resolveDaemonPassword("tcp://missing.example:6767"), undefined);
    assert.strictEqual(resolveDaemonPassword("example.com:6767"), undefined);

    process.env.PASEO_PASSWORD = "env-secret";
    assert.strictEqual(
      resolveDaemonPassword("tcp://example.com:6767?ssl=true&password=query-secret"),
      "query-secret",
      "URI password should take precedence over env var",
    );
    assert.strictEqual(
      resolveDaemonPassword("tcp://missing.example:6767"),
      "env-secret",
      "TCP host without query password should fall back to env var",
    );
    assert.strictEqual(
      resolveDaemonPassword("example.com:6767"),
      "env-secret",
      "Bare host should pick up env var password",
    );
    assert.strictEqual(resolveDaemonPassword("localhost:6767"), "env-secret");

    process.env.PASEO_PASSWORD = "";
    assert.strictEqual(
      resolveDaemonPassword("localhost:6767"),
      undefined,
      "Empty env var should be treated as unset",
    );
  } finally {
    if (previousEnv === undefined) {
      delete process.env.PASEO_PASSWORD;
    } else {
      process.env.PASEO_PASSWORD = previousEnv;
    }
  }
  console.log("✓ daemon password resolution prefers TCP URI query, falls back to env\n");
}

{
  console.log("Test 11: a persisted daemon target becomes the only implicit CLI destination");
  const paseoHome = mkdtempSync(path.join(os.tmpdir(), "paseo-client-default-target-"));
  const offerUrl =
    "https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXJJZCI6InNlcnZlci0xIiwicmVsYXkiOnsiZW5kcG9pbnQiOiJyZWxheS5leGFtcGxlOjQ0MyJ9LCJkYWVtb25QdWJsaWNLZXlCNjQiOiJwdWJsaWMta2V5In0";
  try {
    saveDefaultDaemonTarget(paseoHome, offerUrl);

    assert.strictEqual(readDefaultDaemonTarget(paseoHome), offerUrl);
    assert.deepStrictEqual(selectDaemonTarget({}, { PASEO_HOME: paseoHome }), {
      kind: "endpoint",
      host: offerUrl,
    });
    assert.strictEqual(statSync(path.join(paseoHome, "cli.json")).mode & 0o777, 0o600);
  } finally {
    rmSync(paseoHome, { recursive: true, force: true });
  }
  console.log("✓ persisted target is authoritative and private\n");
}

{
  console.log("Test 12: --host and PASEO_HOST override a persisted daemon target");
  const paseoHome = mkdtempSync(path.join(os.tmpdir(), "paseo-client-env-target-"));
  try {
    saveDefaultDaemonTarget(paseoHome, "m4-mini.example:6767");
    assert.deepStrictEqual(
      selectDaemonTarget({}, { PASEO_HOME: paseoHome, PASEO_HOST: "override.example:7767" }),
      { kind: "endpoint", host: "override.example:7767" },
    );
    assert.deepStrictEqual(
      selectDaemonTarget({ host: "flag.example:7767" }, { PASEO_HOME: paseoHome }),
      { kind: "endpoint", host: "flag.example:7767" },
    );
  } finally {
    rmSync(paseoHome, { recursive: true, force: true });
  }
  console.log("✓ environment target wins over persisted target\n");
}

{
  console.log("Test 13: clearing a persisted daemon target restores the default home");
  const paseoHome = mkdtempSync(path.join(os.tmpdir(), "paseo-client-clear-target-"));
  try {
    saveDefaultDaemonTarget(paseoHome, "m4-mini.example:6767");
    assert.strictEqual(clearDefaultDaemonTarget(paseoHome), true);
    assert.strictEqual(clearDefaultDaemonTarget(paseoHome), false);
    assert.strictEqual(readDefaultDaemonTarget(paseoHome), null);
    assert.deepStrictEqual(selectDaemonTarget({}, { PASEO_HOME: paseoHome }), {
      kind: "instance",
      home: paseoHome,
    });
  } finally {
    rmSync(paseoHome, { recursive: true, force: true });
  }
  console.log("✓ clearing target restores the default home\n");
}

{
  console.log("Test 14: persisted targets accept relay offers and validate direct endpoints");
  const payload = Buffer.from(
    JSON.stringify({
      v: 2,
      serverId: "always-on-daemon",
      daemonPublicKeyB64: "public-key",
      relay: { endpoint: "relay.paseo.sh:443", useTls: true },
    }),
    "utf8",
  ).toString("base64url");
  const offerUrl = `https://app.paseo.sh/#offer=${payload}`;

  assert.strictEqual(normalizeDefaultDaemonTarget(offerUrl), offerUrl);
  assert.strictEqual(normalizeDefaultDaemonTarget("m4-mini:6767"), "m4-mini:6767");
  assert.throws(() => normalizeDefaultDaemonTarget("m4-mini:70000"), /port must be between/);
  assert.throws(() => normalizeDefaultDaemonTarget("https://example.com"), /Invalid daemon target/);
  assert.throws(() => normalizeDefaultDaemonTarget("unix://"), /missing socket path/);
  console.log("✓ relay and direct targets are validated before persistence\n");
}

console.log("=== All CLI IPC target tests passed ===");
