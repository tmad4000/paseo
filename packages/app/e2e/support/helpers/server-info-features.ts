import type { Page } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

interface ServerInfoEnvelope {
  message?: {
    type?: string;
    payload?: { status?: string; features?: Record<string, unknown> };
  };
}

/**
 * Rewrites `server_info.features` on the daemon socket so the app sees an older host. Call before
 * the app connects; later sockets on the page get the same override.
 */
export async function overrideServerInfoFeatures(
  page: Page,
  features: Record<string, boolean>,
): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (browserSocket) => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => serverSocket.send(message));
    serverSocket.onMessage((message) => {
      if (typeof message !== "string") {
        browserSocket.send(message);
        return;
      }
      const envelope = JSON.parse(message) as ServerInfoEnvelope;
      const payload = envelope.message?.payload;
      if (envelope.message?.type !== "status" || payload?.status !== "server_info") {
        browserSocket.send(message);
        return;
      }
      payload.features = { ...payload.features, ...features };
      browserSocket.send(JSON.stringify(envelope));
    });
  });
}
