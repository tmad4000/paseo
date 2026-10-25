import { useEffect, useState } from "react";
import type { DesktopAppUpdateCheckResult, DesktopReleaseChannel } from "./desktop-updates";
import type { ReleaseVersionCheck } from "./version-status";

interface CheckInput {
  open: boolean;
  isDesktopApp: boolean;
  releaseChannel: DesktopReleaseChannel;
  checkForUpdates(options: { intent: "manual" }): Promise<DesktopAppUpdateCheckResult | null>;
}

type CheckSnapshot =
  | {
      channel: DesktopReleaseChannel;
      state: "unknown" | "checking";
    }
  | {
      channel: DesktopReleaseChannel;
      state: "checked";
      result: DesktopAppUpdateCheckResult;
    };

export function useHelpUpdateCheck({
  open,
  isDesktopApp,
  releaseChannel,
  checkForUpdates,
}: CheckInput) {
  const [snapshot, setSnapshot] = useState<CheckSnapshot>({
    channel: releaseChannel,
    state: "unknown",
  });
  useEffect(() => {
    if (!open || !isDesktopApp) return;
    let cancelled = false;
    setSnapshot({ channel: releaseChannel, state: "checking" });
    async function check() {
      try {
        const result = await checkForUpdates({ intent: "manual" });
        if (!cancelled)
          setSnapshot(
            result && !result.errorMessage
              ? { channel: releaseChannel, state: "checked", result }
              : { channel: releaseChannel, state: "unknown" },
          );
      } catch {
        if (!cancelled) setSnapshot({ channel: releaseChannel, state: "unknown" });
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [open, isDesktopApp, releaseChannel, checkForUpdates]);

  // A channel change invalidates the action synchronously, before effects run.
  const current = snapshot.channel === releaseChannel ? snapshot : null;
  const releaseCheck: ReleaseVersionCheck =
    current?.state === "checked"
      ? { state: "checked", latestVersion: current.result.publishedVersion ?? null }
      : { state: current?.state ?? "checking" };
  return {
    releaseCheck,
    canInstall:
      open && isDesktopApp && current?.state === "checked" && current.result.readyToInstall,
  };
}
