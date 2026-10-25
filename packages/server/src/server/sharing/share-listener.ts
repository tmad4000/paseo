import http from "node:http";
import express, { type Request, type Response } from "express";
import type { ShareStore } from "./share-store.js";
import { SHARE_CSP, renderSharePage, unavailablePage } from "./view/page.js";

/** Receives only a shares-directory reader; never mount daemon middleware here. */
export function createShareListener(store: Pick<ShareStore, "view">): http.Server {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  // Do not trust forwarded IP headers: a proxy must enforce its own external IP limits.
  const windows = new Map<string, { until: number; total: number; unknown: number }>();
  const serve = async (request: Request, response: Response) => {
    response.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": SHARE_CSP,
      "X-Content-Type-Options": "nosniff",
    });
    const now = Date.now();
    for (const [ip, value] of windows) if (value.until <= now) windows.delete(ip);
    const ip = request.socket.remoteAddress ?? "unknown";
    let window = windows.get(ip);
    if (!window) {
      // Bound memory even when many distinct IPs hit the listener.
      if (windows.size >= 10000) {
        response.status(429).send("Too many requests");
        return;
      }
      window = { until: now + 60000, total: 0, unknown: 0 };
      windows.set(ip, window);
    }
    const limited = () => {
      response.set("Retry-After", String(Math.max(1, Math.ceil((window.until - now) / 1000))));
      response.status(429).type("text").send("Too many requests");
    };
    if (++window.total > 60) {
      limited();
      return;
    }
    const route =
      request.method === "GET" ? /^\/s\/([A-Za-z0-9_-]{43})(\.json)?$/.exec(request.path) : null;
    let snapshot = null;
    try {
      if (route) snapshot = await store.view(route[1]!);
    } catch {
      /* fail closed without exposing storage errors */
    }
    if (!snapshot) {
      if (++window.unknown > 10) {
        limited();
        return;
      }
      response.status(404).type("html").send(unavailablePage());
      return;
    }
    if (route?.[2]) response.json(snapshot);
    else response.type("html").send(renderSharePage(snapshot));
  };
  app.use((request, response) => {
    void serve(request, response).catch(() => {
      response.status(404).type("html").send(unavailablePage());
    });
  });
  const server = http.createServer(app);
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  });
  return server;
}

export function createConfiguredShareListener(
  config: { listen: string | null } | undefined,
  store: Pick<ShareStore, "view">,
): http.Server | null {
  return config?.listen ? createShareListener(store) : null;
}
