import type { ShareBytes } from "./render.js";

export interface SharePublication extends ShareBytes {
  tokenHash: string;
  expiresAt: string | null;
}
export interface ShareHost {
  publish(value: SharePublication): Promise<void>;
  unpublish(tokenHash: string): Promise<void>;
}
export interface SharingPublisherConfig {
  kind: "cloudflare-worker";
  baseUrl: string;
  adminToken: string;
}
export class LocalListenerHost implements ShareHost {
  async publish(_value: SharePublication): Promise<void> {}
  async unpublish(_tokenHash: string): Promise<void> {}
}
export class CloudflareWorkerHost implements ShareHost {
  constructor(private readonly config: SharingPublisherConfig) {}
  async publish(value: SharePublication): Promise<void> {
    await this.request(
      "PUT",
      value.tokenHash,
      JSON.stringify({
        html: value.html.toString("utf8"),
        json: value.json.toString("utf8"),
        expiresAt: value.expiresAt,
      }),
    );
  }
  async unpublish(tokenHash: string): Promise<void> {
    await this.request("DELETE", tokenHash);
  }
  private async request(method: "PUT" | "DELETE", hash: string, body?: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch(`${this.config.baseUrl}/admin/shares/${hash}`, {
          method,
          body,
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.config.adminToken}`,
            "Content-Type": "application/json",
          },
        });
        await response.body?.cancel();
      } catch {
        if (attempt === 0) continue;
        throw new Error(
          "Share publisher could not be reached (network error or 10 second timeout).",
        );
      } finally {
        clearTimeout(timer);
      }
      if (method === "PUT" && response.status === 404)
        throw new Error(
          "Share publisher returned 404: check its base URL and admin token configuration.",
        );
      if (response.status !== 204)
        throw new Error(`Share publisher ${method} failed (HTTP ${response.status}).`);
      return;
    }
  }
}
