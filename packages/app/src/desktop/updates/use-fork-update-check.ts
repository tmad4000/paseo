import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkDesktopAppUpdate,
  type DesktopAppUpdateCheckIntent,
  type DesktopAppUpdateCheckResult,
  type DesktopReleaseChannel,
} from "./desktop-updates";
import type { ReleaseVersionCheck } from "./version-status";

export const FORK_CHECK_INTERVAL_MS = 30 * 60 * 1000;

interface Snapshot {
  channel: DesktopReleaseChannel;
  checking: boolean;
  result: DesktopAppUpdateCheckResult | null;
}

/** The titlebar observes the feed; installation remains with the idle-only fleet controller. */
export function useForkUpdateCheck(channel: DesktopReleaseChannel) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ channel, checking: true, result: null });
  const request = useRef(0);
  const refresh = useCallback(
    async (intent: DesktopAppUpdateCheckIntent = "manual") => {
      const revision = ++request.current;
      setSnapshot({ channel, checking: true, result: null });
      try {
        const result = await checkDesktopAppUpdate({ releaseChannel: channel, intent });
        if (request.current === revision)
          setSnapshot({ channel, checking: false, result: result.errorMessage ? null : result });
      } catch {
        if (request.current === revision) setSnapshot({ channel, checking: false, result: null });
      }
    },
    [channel],
  );
  const invalidate = useCallback(() => {
    ++request.current;
  }, []);
  useEffect(() => {
    void refresh("automatic");
    const timer = setInterval(() => void refresh("automatic"), FORK_CHECK_INTERVAL_MS);
    return () => {
      invalidate();
      clearInterval(timer);
    };
  }, [refresh, invalidate]);
  const current = snapshot.channel === channel ? snapshot : null;
  let check: ReleaseVersionCheck = { state: "unknown" };
  if (!current || current.checking) check = { state: "checking" };
  else if (current.result)
    check = { state: "checked", latestVersion: current.result.publishedVersion ?? null };
  return { check, result: current?.result ?? null, refresh };
}
