import http from "node:http";
import type { Duplex } from "node:stream";
import express, { type Request, type Response } from "express";
import type { ShareBytes } from "./render.js";
import { ShareRateLimiter } from "./share-rate-limiter.js";
import { SHARE_CSP, unavailablePage } from "./view/page.js";

export interface ShareReader {
  view(token: string): Promise<ShareBytes | null>;
}
interface ShareListenerOptions {
  trustForwardedFor?: boolean;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": SHARE_CSP,
  "X-Content-Type-Options": "nosniff",
};

function rejectSocket(socket: Duplex, until: number | null): void {
  const status = until === null ? 404 : 429;
  const body = until === null ? unavailablePage() : "Too many requests";
  const headers = {
    ...SECURITY_HEADERS,
    Connection: "close",
    "Content-Type": until === null ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    ...(until === null
      ? {}
      : { "Retry-After": String(Math.max(1, Math.ceil((until - Date.now()) / 1000))) }),
  };
  const head = Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");
  socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\n${head}\r\n${body}`);
}

/** Receives only a shares-directory reader; never mount daemon middleware here. */
export function createShareListener(
  reader: ShareReader,
  options: ShareListenerOptions = {},
): http.Server {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("query parser", false);
  const limits = new ShareRateLimiter(options.trustForwardedFor);
  const serve = async (request: Request, response: Response) => {
    response.set(SECURITY_HEADERS);
    const now = Date.now();
    const limited = (until: number) => {
      response.set("Retry-After", String(Math.max(1, Math.ceil((until - now) / 1000))));
      response.status(429).type("text").send("Too many requests");
    };
    const globalUntil = limits.globalUntil(now);
    if (globalUntil !== null) {
      limited(globalUntil);
      return;
    }
    const window = limits.peerWindow(
      request.socket.remoteAddress ?? "unknown",
      request.headers["x-forwarded-for"],
      now,
    );
    if (window.total > 60) {
      limited(window.until);
      return;
    }
    if (request.url.length > 256 || (request.method !== "GET" && request.method !== "HEAD")) {
      response.status(404).type("html").send(unavailablePage());
      return;
    }
    const route = /^\/s\/([A-Za-z0-9_-]{43})(\.json)?$/.exec(request.path);
    let snapshot = null;
    try {
      if (route) snapshot = await reader.view(route[1]!);
    } catch {
      /* fail closed without exposing storage errors */
    }
    if (!snapshot) {
      if (++window.unknown > 10) {
        limited(window.until);
        return;
      }
      response.status(404).type("html").send(unavailablePage());
      return;
    }
    const bytes = route?.[2] ? snapshot.json : snapshot.html;
    response.set(
      "Content-Type",
      route?.[2] ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
    );
    response.set("Content-Length", String(bytes.byteLength));
    response.end(request.method === "HEAD" ? undefined : bytes);
  };
  app.use((request, response) => {
    void serve(request, response).catch(() => {
      response.status(404).type("html").send(unavailablePage());
    });
  });
  const server = http.createServer(app);
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  const reject = (request: http.IncomingMessage, socket: Duplex) => {
    const now = Date.now();
    let until = limits.globalUntil(now);
    if (until === null) {
      const window = limits.peerWindow(
        request.socket.remoteAddress ?? "unknown",
        request.headers["x-forwarded-for"],
        now,
      );
      if (window.total > 60) until = window.until;
    }
    rejectSocket(socket, until);
  };
  server.on("upgrade", reject);
  server.on("connect", reject);
  return server;
}

export function createConfiguredShareListener(
  config: ({ listen: string | null } & ShareListenerOptions) | undefined,
  reader: ShareReader,
): http.Server | null {
  return config?.listen ? createShareListener(reader, config) : null;
}
