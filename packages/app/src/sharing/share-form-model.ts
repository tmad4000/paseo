import {
  DEFAULT_REDACTION,
  type RedactionProfile,
  type ShareSnapshot,
} from "@getpaseo/protocol/sharing";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

export type ShareExpiry = "never" | "24h" | "7d" | "30d";
interface ShareFormState {
  profile: RedactionProfile;
  expiry: ShareExpiry;
  preview:
    | { status: "loading" }
    | { status: "loaded"; snapshot: ShareSnapshot }
    | { status: "error"; message: string };
  creating: boolean;
  url: string | null;
  error: string | null;
}
type ShareFormClient = Pick<DaemonClient, "previewShareLink" | "createShareLink">;
export function openShareForm(client: ShareFormClient, agentId: string) {
  let state: ShareFormState = {
    profile: structuredClone(DEFAULT_REDACTION),
    expiry: "7d",
    preview: { status: "loading" },
    creating: false,
    url: null,
    error: null,
  };
  let alive = true;
  let version = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<ShareFormState>) => {
    if (!alive) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const refresh = async () => {
    const request = ++version;
    publish({ preview: { status: "loading" } });
    try {
      const snapshot = await client.previewShareLink(agentId, state.profile);
      if (alive && request === version) publish({ preview: { status: "loaded", snapshot } });
    } catch (error) {
      if (alive && request === version)
        publish({ preview: { status: "error", message: String(error) } });
    }
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    start: () => {
      alive = true;
      return refresh();
    },
    close: () => {
      alive = false;
      version++;
      listeners.clear();
    },
    setExpiry: (expiry: ShareExpiry) => {
      if (!state.creating) publish({ expiry });
    },
    setInclude: (key: keyof RedactionProfile["include"], value: boolean) => {
      if (state.creating) return;
      publish({
        profile: { ...state.profile, include: { ...state.profile.include, [key]: value } },
        url: null,
      });
      void refresh();
    },
    setScrub: (key: keyof RedactionProfile["scrub"], value: boolean) => {
      if (state.creating) return;
      publish({
        profile: { ...state.profile, scrub: { ...state.profile.scrub, [key]: value } },
        url: null,
      });
      void refresh();
    },
    create: async (): Promise<string | null> => {
      if (!alive || state.creating || state.preview.status !== "loaded") return null;
      publish({ creating: true, error: null });
      try {
        const days = { "24h": 1, "7d": 7, "30d": 30 };
        const expiresAt =
          state.expiry === "never"
            ? null
            : new Date(Date.now() + days[state.expiry] * 86400000).toISOString();
        const previewDigest =
          state.preview.status === "loaded" ? state.preview.snapshot.sourceDigest : undefined;
        const result = await client.createShareLink({
          agentId,
          redaction: state.profile,
          expiresAt,
          previewDigest,
        });
        publish({ url: result.url });
        return alive ? result.url : null;
      } catch (error) {
        publish({ error: String(error) });
        await refresh();
        return null;
      } finally {
        publish({ creating: false });
      }
    },
  };
}
export type ShareFormModel = ReturnType<typeof openShareForm>;
