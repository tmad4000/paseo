import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareWorkerHost, LocalListenerHost } from "./share-host.js";

const config = {
  kind: "cloudflare-worker" as const,
  baseUrl: "https://shares.example",
  adminToken: "fixture-admin",
};
const value = {
  tokenHash: "a".repeat(64),
  html: Buffer.from("<p>hello</p>"),
  json: Buffer.from("{}"),
  expiresAt: null,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("share hosts", () => {
  it("keeps the listener host local", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const host = new LocalListenerHost();
    await host.publish(value);
    await host.unpublish(value.tokenHash);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends only redacted artifacts and hash with Bearer auth, without following redirects", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const host = new CloudflareWorkerHost(config);
    await host.publish(value);
    expect(fetch).toHaveBeenCalledWith(
      `${config.baseUrl}/admin/shares/${value.tokenHash}`,
      expect.objectContaining({
        method: "PUT",
        redirect: "error",
        headers: { Authorization: "Bearer fixture-admin", "Content-Type": "application/json" },
        body: JSON.stringify({ html: "<p>hello</p>", json: "{}", expiresAt: null }),
        signal: expect.any(AbortSignal),
      }),
    );
    await host.unpublish(value.tokenHash);
    expect(fetch.mock.lastCall?.[1]).toMatchObject({ method: "DELETE", body: undefined });
  });
  it("retries a network failure once, but never an HTTP failure", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await new CloudflareWorkerHost(config).publish(value);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockReset().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(new CloudflareWorkerHost(config).publish(value)).rejects.toThrow(
      "base URL and admin token",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("aborts at 10 seconds and retries only once without leaking the upstream error", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(abortingFetch);
    vi.stubGlobal("fetch", fetch);
    const pending = new CloudflareWorkerHost(config).publish(value);
    const assertion = expect(pending).rejects.toThrow("10 second timeout");
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

function abortingFetch(_url: string, options: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(new Error("secret upstream URL")));
  });
}
