import { BlockList, isIP } from "node:net";

const trustedPeers = new BlockList();
trustedPeers.addSubnet("127.0.0.0", 8, "ipv4");
trustedPeers.addAddress("::1", "ipv6");
trustedPeers.addSubnet("100.64.0.0", 10, "ipv4");

export function shareRateLimitKey(
  peer: string,
  forwardedFor: string | string[] | undefined,
  trustForwardedFor: boolean,
): string {
  const family = isIP(peer);
  const trusted = family !== 0 && trustedPeers.check(peer, family === 6 ? "ipv6" : "ipv4");
  if (!trustForwardedFor || !trusted) return peer;
  const header = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const first = header?.split(",")[0]?.trim();
  return first && isIP(first) !== 0 ? first : peer;
}

interface Window {
  until: number;
  total: number;
  unknown: number;
}
export class ShareRateLimiter {
  private global = { until: 0, total: 0 };
  private readonly windows = new Map<string, Window>();
  constructor(private readonly trustForwardedFor = false) {}

  /** Count all HTTP requests, including rejected paths/methods and exhausted peer budgets. */
  globalUntil(now: number): number | null {
    if (this.global.until <= now) this.global = { until: now + 60_000, total: 0 };
    return ++this.global.total > 600 ? this.global.until : null;
  }
  peerWindow(peer: string, forwardedFor: string | string[] | undefined, now: number): Window {
    for (const [key, value] of this.windows) if (value.until <= now) this.windows.delete(key);
    const key = shareRateLimitKey(peer, forwardedFor, this.trustForwardedFor);
    let window = this.windows.get(key);
    if (!window) {
      // The global budget bounds how many new keys can be allocated each minute.
      window = { until: now + 60_000, total: 0, unknown: 0 };
      this.windows.set(key, window);
    }
    window.total++;
    return window;
  }
}
