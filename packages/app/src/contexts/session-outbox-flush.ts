import {
  parseServerInfoStatusPayload,
  type ServerInfoStatusPayload,
} from "@getpaseo/protocol/messages";

export type ServerInfoFeatures = ServerInfoStatusPayload["features"];

export interface OutboxReconnectClient {
  readonly isConnected: boolean;
  getLastServerInfoMessage: () => ServerInfoStatusPayload | null;
}

/**
 * Runs `flush` on every (re)connect and once now if already connected.
 *
 * The connect-time server_info is a raw session message the daemon sends before
 * any owned event subscription exists, so an `observeEvents` feed never sees it.
 * Listening on the client directly is what makes "retry on reconnect" real; the
 * immediate call covers a cold start that connected before this subscriber.
 * See docs/queue-mirroring.md, "The un-acked window".
 */
export function startOutboxReconnectFlush(input: {
  client: OutboxReconnectClient;
  /** Subscribes to raw `status` session messages, e.g. `client.on("status", …)`. */
  subscribeStatus: (handler: (payload: unknown) => void) => () => void;
  flush: (features: ServerInfoFeatures) => void;
}): () => void {
  const unsubscribe = input.subscribeStatus((payload) => {
    const serverInfo = parseServerInfoStatusPayload(payload);
    if (serverInfo) input.flush(serverInfo.features);
  });
  if (input.client.isConnected) {
    const serverInfo = input.client.getLastServerInfoMessage();
    if (serverInfo) input.flush(serverInfo.features);
  }
  return unsubscribe;
}
