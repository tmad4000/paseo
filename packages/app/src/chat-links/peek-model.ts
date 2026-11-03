import { useCallback, useEffect, useState } from "react";

/** A page that has not loaded by now is treated as refusing to be framed. */
export const PEEK_LOAD_TIMEOUT_MS = 6_000;

/**
 * Peek lays a page out at a desktop viewport and scales it down, so it looks like its desktop
 * self instead of a squeezed phone layout.
 */
export const PEEK_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Sites that send `X-Frame-Options` or `frame-ancestors` for every page. A blocked frame still
 * fires `load` (with the browser's error page), so these go straight to the fallback card.
 */
const FRAME_BLOCKED_HOSTS = [
  "github.com",
  "google.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "apple.com",
  "stackoverflow.com",
];

export function isKnownFrameBlocked(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return FRAME_BLOCKED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

/**
 * A page on the app's own origin would be same-origin with Paseo inside a scripted frame and
 * could lift its own sandbox, so it is never framed. Native has no app origin.
 */
export function isSameOriginAsApp(url: string): boolean {
  const origin = typeof window === "undefined" ? undefined : window.location?.origin;
  if (!origin || origin === "null") return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return true;
  }
}

export type PeekFrameStatus = "loading" | "loaded" | "blocked";

/** The scale that fits the desktop viewport inside a body of the given size. */
export function peekScale(body: { width: number; height: number }): number {
  if (body.width <= 0 || body.height <= 0) return 1;
  return Math.min(1, body.width / PEEK_VIEWPORT.width, body.height / PEEK_VIEWPORT.height);
}

/**
 * Loading until the frame reports `load`; blocked when it never does within the timeout, when
 * the host is known to refuse framing, or when the caller already knows it cannot be framed.
 */
export function usePeekFrameStatus(input: { url: string; refused?: boolean }): {
  status: PeekFrameStatus;
  onLoad: () => void;
  /** A load error the platform reports (native WebView); the iframe never reports one. */
  onError: () => void;
} {
  const immediatelyBlocked =
    input.refused === true || isKnownFrameBlocked(input.url) || isSameOriginAsApp(input.url);
  const initialStatus: PeekFrameStatus = immediatelyBlocked ? "blocked" : "loading";
  const [state, setState] = useState<{ url: string; status: PeekFrameStatus }>(() => ({
    url: input.url,
    status: initialStatus,
  }));
  // A new URL starts over before the effect below has caught up.
  const current = state.url === input.url ? state.status : initialStatus;

  useEffect(() => {
    if (immediatelyBlocked) {
      setState({ url: input.url, status: "blocked" });
      return;
    }
    setState({ url: input.url, status: "loading" });
    const timer = setTimeout(() => {
      setState((previous) =>
        previous.url === input.url && previous.status === "loaded"
          ? previous
          : { url: input.url, status: "blocked" },
      );
    }, PEEK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [immediatelyBlocked, input.url]);

  const onLoad = useCallback(() => {
    setState((previous) =>
      previous.url === input.url && previous.status === "blocked"
        ? previous
        : { url: input.url, status: "loaded" },
    );
  }, [input.url]);

  const onError = useCallback(() => {
    setState({ url: input.url, status: "blocked" });
  }, [input.url]);

  return { status: current, onLoad, onError };
}
