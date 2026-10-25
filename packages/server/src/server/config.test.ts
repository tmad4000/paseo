import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

import { loadConfig, resolveBundledWebUiDistDir, resolveConfigFromPersisted } from "./config.js";
import { loadPersistedConfig } from "./persisted-config.js";

const roots: string[] = [];

describe("server config", () => {
  test("loads a persisted publisher token at startup, warns for readable files, and honors env overrides", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-publisher-"));
    roots.push(paseoHome);
    const tokenFile = path.join(paseoHome, "admin-token");
    await writeFile(tokenFile, "fixture-admin\n", { mode: 0o600 });
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        version: 1,
        daemon: {
          sharing: {
            publisher: {
              kind: "cloudflare-worker",
              baseUrl: "https://shares.example/",
              adminTokenFile: tokenFile,
            },
          },
        },
      }),
    );
    expect(loadConfig(paseoHome, { env: {} }).sharing).toMatchObject({
      listen: null,
      publicBaseUrl: null,
      publisher: {
        kind: "cloudflare-worker",
        baseUrl: "https://shares.example",
        adminToken: "fixture-admin",
      },
    });
    const tokenOnly = loadConfig(paseoHome, {
      env: { PASEO_SHARING_PUBLISHER_TOKEN: "env-admin" },
    });
    expect(tokenOnly.configReload?.overrideControlledPaths).toContain(
      "daemon.sharing.publisher.adminTokenFile",
    );
    expect(tokenOnly.configReload?.overrideControlledPaths).not.toContain(
      "daemon.sharing.publisher",
    );
    expect(tokenOnly.configReload?.overrideControlledPaths).not.toContain(
      "daemon.sharing.publisher.baseUrl",
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await chmod(tokenFile, 0o644);
      loadConfig(paseoHome, { env: {} });
      if (process.platform !== "win32")
        expect(warning).toHaveBeenCalledWith(expect.stringContaining("mode 600"));
      expect(
        loadConfig(paseoHome, {
          env: {
            PASEO_SHARING_PUBLISHER_BASE_URL: "https://other.example",
            PASEO_SHARING_PUBLISHER_TOKEN: "env-admin",
          },
        }).sharing?.publisher,
      ).toMatchObject({ baseUrl: "https://other.example", adminToken: "env-admin" });
      expect(
        loadConfig(paseoHome, {
          env: {
            PASEO_SHARING_PUBLISHER_BASE_URL: "https://other.example",
            PASEO_SHARING_PUBLISHER_TOKEN_FILE: tokenFile,
          },
        }).sharing?.publisher?.adminToken,
      ).toBe("fixture-admin");
      expect(() =>
        loadConfig(paseoHome, {
          env: {
            PASEO_SHARING_PUBLISHER_BASE_URL: "https://user:pass@other.example",
            PASEO_SHARING_PUBLISHER_TOKEN: "env-admin",
          },
        }),
      ).toThrow("without credentials");
    } finally {
      warning.mockRestore();
    }
  });
  test("sharing is opt-in, persisted and overridable by environment", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-sharing-"));
    roots.push(paseoHome);
    expect(loadConfig(paseoHome, { env: {} }).sharing).toMatchObject({
      listen: null,
      publicBaseUrl: null,
      ownerDisplayName: expect.any(String),
      trustForwardedFor: false,
    });
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        version: 1,
        daemon: {
          sharing: {
            listen: "127.0.0.1:8443",
            publicBaseUrl: "https://share.example",
            ownerDisplayName: "Jacob",
          },
        },
      }),
    );
    expect(loadConfig(paseoHome, { env: {} }).sharing).toEqual({
      listen: "127.0.0.1:8443",
      publicBaseUrl: "https://share.example",
      ownerDisplayName: "Jacob",
      trustForwardedFor: false,
    });
    const config = loadConfig(paseoHome, {
      env: {
        PASEO_SHARING_LISTEN: "127.0.0.1:9443",
        PASEO_SHARING_PUBLIC_BASE_URL: "https://other.example",
        PASEO_SHARING_OWNER_NAME: "Owner",
      },
    });
    expect(config.sharing).toEqual({
      listen: "127.0.0.1:9443",
      publicBaseUrl: "https://other.example",
      ownerDisplayName: "Owner",
      trustForwardedFor: false,
    });
  });
  test("forwarded share limits default off, persist, and honor environment overrides", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-share-proxy-"));
    roots.push(paseoHome);
    expect(loadConfig(paseoHome, { env: {} }).sharing?.trustForwardedFor).toBe(false);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({ version: 1, daemon: { sharing: { trustForwardedFor: true } } }),
    );
    expect(loadConfig(paseoHome, { env: {} }).sharing?.trustForwardedFor).toBe(true);
    const config = loadConfig(paseoHome, { env: { PASEO_SHARING_TRUST_FORWARDED_FOR: "false" } });
    expect(config.sharing?.trustForwardedFor).toBe(false);
    expect(config.configReload?.overrideControlledPaths).toContain(
      "daemon.sharing.trustForwardedFor",
    );
    expect(
      loadConfig(paseoHome, { env: { PASEO_SHARING_TRUST_FORWARDED_FOR: "true" } }).sharing
        ?.trustForwardedFor,
    ).toBe(true);
  });
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("records when the daemon is managed by Paseo Desktop", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-desktop-managed-"));
    roots.push(paseoHome);

    const desktopConfig = loadConfig(paseoHome, {
      env: { PASEO_DESKTOP_MANAGED: "1" },
    });
    const standaloneConfig = loadConfig(paseoHome, { env: {} });

    expect(desktopConfig.desktopManaged).toBe(true);
    expect(standaloneConfig.desktopManaged).toBe(false);
  });

  test("loads the provider catalog refresh timeout", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-provider-timeout-"));
    roots.push(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({ agents: { catalogRefreshTimeoutMs: 180_000 } }),
    );

    const config = loadConfig(paseoHome, { env: {} });

    expect(config.providerCatalogRefreshTimeoutMs).toBe(180_000);
  });

  test("resolves reload state from the supplied validated snapshot", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-snapshot-"));
    roots.push(paseoHome);
    const snapshot = loadPersistedConfig(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        ...snapshot,
        daemon: { ...snapshot.daemon, browserTools: { enabled: true } },
      }),
    );

    expect(resolveConfigFromPersisted(paseoHome, snapshot, { env: {} }).browserToolsEnabled).toBe(
      false,
    );
    expect(loadConfig(paseoHome, { env: {} }).browserToolsEnabled).toBe(true);
  });

  test("records mutable and startup launch overrides by persisted leaf", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-overrides-"));
    roots.push(paseoHome);
    const config = loadConfig(paseoHome, {
      env: {
        PASEO_LISTEN: "127.0.0.1:7000",
        PASEO_PASSWORD: "secret",
        PASEO_RELAY_ENDPOINT: "relay.example.test:443",
        PASEO_TRUSTED_PROXIES: "true",
        PASEO_WEB_UI_ENABLED: "true",
        PASEO_LOG_FILE_PATH: "custom.log",
        PASEO_VOICE_LLM_PROVIDER: "codex",
      },
      cli: { relayUseTls: false },
    });

    expect(config.configReload?.overrideControlledPaths).toEqual([
      "daemon.auth.password",
      "daemon.listen",
      "daemon.relay.endpoint",
      "daemon.relay.useTls",
      "daemon.trustedProxies",
      "features.voiceMode.llm.provider",
      "features.webUi.enabled",
      "log.file.path",
    ]);
    expect(config.listen).toBe("127.0.0.1:7000");
    expect(config.trustedProxies).toBe(true);
    expect(config.log?.file?.path).toBe("custom.log");
    expect(config.voiceLlmProvider).toBe("codex");
  });

  test.each([
    {
      name: "local speech providers",
      providers: { dictation: "local", voiceStt: "local", voiceTts: "local" },
      expected: [
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
    {
      name: "OpenAI speech providers",
      providers: { dictation: "openai", voiceStt: "openai", voiceTts: "openai" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
        "features.voiceMode.tts.voice",
      ],
    },
    {
      name: "mixed local and OpenAI speech providers",
      providers: { dictation: "local", voiceStt: "openai", voiceTts: "local" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
  ])("classifies speech overrides for $name", ({ providers, expected }) => {
    const config = resolveConfigFromPersisted(
      "/tmp/paseo-speech-override-classification",
      {
        version: 1,
        features: {
          dictation: { enabled: true, stt: { provider: providers.dictation } },
          voiceMode: {
            enabled: true,
            stt: { provider: providers.voiceStt },
            tts: { provider: providers.voiceTts },
          },
        },
      },
      {
        env: {
          OPENAI_API_KEY: "test-api-key",
          PASEO_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          PASEO_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          PASEO_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
          STT_CONFIDENCE_THRESHOLD: "0.5",
          STT_MODEL: "whisper-1",
          TTS_MODEL: "tts-1",
          TTS_VOICE: "alloy",
        },
      },
    );

    expect(config.configReload?.overrideControlledPaths).toEqual(expected);
  });

  test("resolves bundled web UI path from source-tree modules", () => {
    const root = path.parse(process.cwd()).root;
    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(root, "repo", "packages", "server", "src", "server", "config.ts"),
        ),
      }),
    ).toBe(path.join(root, "repo", "packages", "server", "dist", "server", "web-ui"));
  });

  test("resolves bundled web UI path from globally installed compiled modules", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-config-compiled-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "dist", "server", "web-ui"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(path.join(packageRoot, "dist", "server", "server", "config.js")),
      }),
    ).toBe(path.join(packageRoot, "dist", "server", "web-ui"));
  });

  test("resolves packaged desktop web UI path from resources app-dist", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-config-packaged-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "app-dist"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(
            packageRoot,
            "app.asar",
            "node_modules",
            "@getpaseo",
            "server",
            "dist",
            "server",
            "server",
            "config.js",
          ),
        ),
        resourcesPath: packageRoot,
      }),
    ).toBe(path.join(packageRoot, "app-dist"));
  });
});
