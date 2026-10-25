import { describe, expect, it } from "vitest";
import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";

import {
  startOutboxReconnectFlush,
  type OutboxReconnectClient,
  type ServerInfoFeatures,
} from "./session-outbox-flush";

function serverInfo(features: ServerInfoFeatures): ServerInfoStatusPayload {
  return {
    status: "server_info",
    serverId: "server",
    hostname: "host",
    version: "1.0.0",
    features,
  } as ServerInfoStatusPayload;
}

function createClient(input: { connected: boolean; lastServerInfo?: ServerInfoStatusPayload }) {
  const handlers = new Set<(payload: unknown) => void>();
  const client: OutboxReconnectClient = {
    isConnected: input.connected,
    getLastServerInfoMessage: () => input.lastServerInfo ?? null,
  };
  const subscribeStatus = (handler: (payload: unknown) => void) => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  };
  const emit = (payload: unknown) => {
    for (const handler of handlers) handler(payload);
  };
  return { client, emit, subscribeStatus };
}

describe("startOutboxReconnectFlush", () => {
  // Regression: the flush used to listen through the owned event feed, which
  // never receives the connect-time server_info, so un-acked messages stayed
  // "Waiting to sync with host" until something else reconnected them.
  it("flushes on the raw connect-time server_info", () => {
    const { client, emit, subscribeStatus } = createClient({ connected: false });
    const flushed: ServerInfoFeatures[] = [];

    startOutboxReconnectFlush({
      client,
      subscribeStatus,
      flush: (features) => flushed.push(features),
    });
    emit(serverInfo({ agentMessageQueue: true }));

    expect(flushed).toEqual([{ agentMessageQueue: true }]);
  });

  it("flushes immediately on a cold start that connected before subscribing", () => {
    const { client, subscribeStatus } = createClient({
      connected: true,
      lastServerInfo: serverInfo({ agentMessageQueue: true }),
    });
    const flushed: ServerInfoFeatures[] = [];

    startOutboxReconnectFlush({
      client,
      subscribeStatus,
      flush: (features) => flushed.push(features),
    });

    expect(flushed).toEqual([{ agentMessageQueue: true }]);
  });

  it("waits for a connection before using a remembered server_info", () => {
    const { client, subscribeStatus } = createClient({
      connected: false,
      lastServerInfo: serverInfo({ agentMessageQueue: true }),
    });
    const flushed: ServerInfoFeatures[] = [];

    startOutboxReconnectFlush({
      client,
      subscribeStatus,
      flush: (features) => flushed.push(features),
    });

    expect(flushed).toEqual([]);
  });

  it("ignores other status messages and stops after unsubscribe", () => {
    const { client, emit, subscribeStatus } = createClient({ connected: false });
    const flushed: ServerInfoFeatures[] = [];

    const stop = startOutboxReconnectFlush({
      client,
      subscribeStatus,
      flush: (features) => flushed.push(features),
    });
    emit({ status: "daemon_config_changed", config: {} });
    stop();
    emit(serverInfo({ agentMessageQueue: true }));

    expect(flushed).toEqual([]);
  });
});
