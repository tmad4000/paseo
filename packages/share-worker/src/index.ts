import { SHARE_CSP, unavailablePage } from "./page.js";

interface Metadata {
  createdAt: string;
  expiresAt: string | null;
}
interface KV {
  getWithMetadata(
    key: string,
    type: "text",
  ): Promise<{ value: string | null; metadata: Metadata | null }>;
  put(
    key: string,
    value: string,
    options: { metadata: Metadata; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}
interface RateLimit {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}
export interface Env {
  SHARES: KV;
  ADMIN_TOKEN: string;
  GUEST_LIMIT: RateLimit;
  UNKNOWN_LIMIT: RateLimit;
  ADMIN_LIMIT: RateLimit;
}
export const GUEST_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": SHARE_CSP,
  "X-Content-Type-Options": "nosniff",
};
const MAX_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const unavailable = () =>
  new Response(unavailablePage(), {
    status: 404,
    headers: { ...GUEST_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
const error = (status: number) => new Response(null, { status, headers: GUEST_HEADERS });
async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
async function authorized(request: Request, secret: string): Promise<boolean> {
  if (!secret) return false;
  // Hash both inputs to fixed lengths before comparing every byte without early exit.
  const [actual, expected] = await Promise.all([
    digest(request.headers.get("Authorization") ?? ""),
    digest(`Bearer ${secret}`),
  ]);
  let difference = 0;
  for (let index = 0; index < expected.length; index++)
    difference |= actual[index]! ^ expected[index]!;
  return difference === 0;
}
async function readBody(request: Request): Promise<unknown> {
  // JSON escaping can expand the two 2 MiB strings up to sixfold.
  const maxBody = 12 * MAX_BYTES + 1024;
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > maxBody) {
      await reader.cancel();
      throw new Error("Body too large");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
interface Publication {
  html: string;
  json: string;
  expiresAt: string | null;
}
function isExpiry(value: unknown): value is string | null {
  if (value === null) return true;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}
async function readPublication(request: Request): Promise<Publication | null> {
  try {
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const data = body as Record<string, unknown>;
    if (
      typeof data.html !== "string" ||
      typeof data.json !== "string" ||
      encoder.encode(data.html).byteLength > MAX_BYTES ||
      encoder.encode(data.json).byteLength > MAX_BYTES ||
      !isExpiry(data.expiresAt)
    )
      return null;
    JSON.parse(data.json);
    return { html: data.html, json: data.json, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}
async function admin(request: Request, env: Env, pathname: string, ip: string): Promise<Response> {
  const allowed = (await env.ADMIN_LIMIT.limit({ key: ip })).success;
  if (!(await authorized(request, env.ADMIN_TOKEN))) return unavailable();
  if (!allowed) return error(429);
  const route = /^\/admin\/shares\/([a-f0-9]{64})$/.exec(pathname);
  if (!route || !["PUT", "DELETE"].includes(request.method)) return unavailable();
  const hash = route[1]!;
  if (request.method === "DELETE") {
    await Promise.all([env.SHARES.delete(`h:${hash}`), env.SHARES.delete(`j:${hash}`)]);
    return error(204);
  }
  const value = await readPublication(request);
  if (!value) return error(400);
  const ttl =
    value.expiresAt === null
      ? undefined
      : Math.max(60, Math.ceil((Date.parse(value.expiresAt) - Date.now()) / 1000));
  const options = {
    metadata: { createdAt: new Date().toISOString(), expiresAt: value.expiresAt },
    ...(ttl === undefined ? {} : { expirationTtl: ttl }),
  };
  // Complete both writes before acknowledging publication. On failure, fail closed and clean up.
  const writes = await Promise.allSettled([
    env.SHARES.put(`h:${hash}`, value.html, options),
    env.SHARES.put(`j:${hash}`, value.json, options),
  ]);
  if (writes.some((write) => write.status === "rejected")) {
    await Promise.allSettled([env.SHARES.delete(`h:${hash}`), env.SHARES.delete(`j:${hash}`)]);
    return error(503);
  }
  return error(204);
}
async function guest(request: Request, env: Env, pathname: string, ip: string): Promise<Response> {
  if (!(await env.GUEST_LIMIT.limit({ key: ip })).success) return error(429);
  const route =
    request.method === "GET" ? /^\/s\/([A-Za-z0-9_-]{43})(\.json)?$/.exec(pathname) : null;
  if (route) {
    const hash = Array.from(await digest(route[1]!), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const entry = await env.SHARES.getWithMetadata(`${route[2] ? "j" : "h"}:${hash}`, "text");
    if (
      entry.value !== null &&
      entry.metadata &&
      (entry.metadata.expiresAt === null || Date.parse(entry.metadata.expiresAt) > Date.now())
    )
      return new Response(entry.value, {
        headers: {
          ...GUEST_HEADERS,
          "Content-Type": route[2] ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
        },
      });
  }
  if (!(await env.UNKNOWN_LIMIT.limit({ key: ip })).success) return error(429);
  return unavailable();
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const pathname = new URL(request.url).pathname;
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      return await (pathname.startsWith("/admin/")
        ? admin(request, env, pathname, ip)
        : guest(request, env, pathname, ip));
    } catch {
      return unavailable();
    }
  },
};
