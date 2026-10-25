import { randomUUID } from "node:crypto";
import { DaemonClient as CompiledDaemonClient } from "@getpaseo/client/internal/daemon-client";
import * as protocolSchemas from "@getpaseo/protocol/messages";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getE2EDaemonPort } from "./daemon-port";
import { createNodeWebSocketFactory, type NodeWebSocketFactory } from "./node-ws-factory";

export async function loadDaemonClientConstructor<ClientConfig, ClientInstance>(): Promise<
  new (config: ClientConfig) => ClientInstance
> {
  // Keep the SDK in Playwright's static module graph. Mixing a native dynamic import with
  // transformed protocol imports loses named exports in Node 22's CJS/ESM bridge.
  return CompiledDaemonClient as unknown as new (config: ClientConfig) => ClientInstance;
}

interface E2EDaemonClientConfig {
  url: string;
  clientId: string;
  clientType: "cli";
  appVersion?: string;
  webSocketFactory?: NodeWebSocketFactory;
}

function resolveDaemonWsUrl(port?: number): string {
  return `ws://127.0.0.1:${port ?? getE2EDaemonPort()}/ws`;
}

export interface ConnectDaemonClientOptions {
  clientIdPrefix: string;
  appVersion?: string;
  port?: number;
}

/**
 * Connects an in-test daemon client over the isolated E2E daemon's WebSocket.
 * The port-6767 guard keeps tests off the developer daemon. Each helper passes
 * its own typed client interface as the generic.
 */
export async function connectDaemonClient<ClientInstance extends { connect(): Promise<void> }>(
  options: ConnectDaemonClientOptions,
): Promise<ClientInstance> {
  const DaemonClient = await loadDaemonClientConstructor<E2EDaemonClientConfig, ClientInstance>();
  const client = new DaemonClient({
    url: resolveDaemonWsUrl(options.port),
    clientId: `${options.clientIdPrefix}-${randomUUID()}`,
    clientType: "cli",
    appVersion: options.appVersion ?? loadAppVersion(),
    webSocketFactory: createNodeWebSocketFactory(),
  });
  await client.connect();
  return client;
}

function loadAppVersion(): string {
  const packageJsonPath = path.resolve(__dirname, "../../../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`Missing app version in ${packageJsonPath}`);
  }
  return packageJson.version;
}

export async function loadProtocolSchemas(): Promise<typeof import("@getpaseo/protocol/messages")> {
  return protocolSchemas;
}
