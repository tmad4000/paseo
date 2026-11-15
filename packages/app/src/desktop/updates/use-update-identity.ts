import { useFetchQuery } from "@/data/query";
import { getDesktopDaemonStatus, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import {
  getDesktopRuntimeInfo,
  shouldShowDesktopUpdateSection,
  type DesktopAppUpdateCheckResult,
  type DesktopRuntimeInfo,
} from "./desktop-updates";
import {
  formatUpdateRestartEffect,
  resolvePublishedRelease,
  resolveUpdateIdentity,
  resolveUpdateRestartEffect,
  type UpdateIdentity,
} from "./update-identity";

const RUNTIME_INFO_QUERY_KEY = ["desktopRuntimeInfo"] as const;
const RESTART_DAEMON_QUERY_KEY = ["desktopDaemonStatus", "updateRestart"] as const;

/** The desktop shell's product name and update feed; null outside Electron or while loading. */
export function useDesktopRuntimeInfo(): DesktopRuntimeInfo | null {
  const { data } = useFetchQuery({
    queryKey: RUNTIME_INFO_QUERY_KEY,
    queryFn: getDesktopRuntimeInfo,
    dataShape: "value",
    enabled: shouldShowDesktopUpdateSection(),
    immutableWhen: () => true,
    retry: false,
  });
  return data ?? null;
}

/**
 * The identity line for `version` on an update surface. Pass the latest check
 * result so the release notes link uses the tag the feed published.
 */
export function useUpdateIdentity(
  version: string | null | undefined,
  result: Pick<DesktopAppUpdateCheckResult, "publishedVersion" | "publishedTag"> | null,
): UpdateIdentity | null {
  const { settings } = useDesktopSettings();
  const runtime = useDesktopRuntimeInfo();
  if (!runtime || !version) return null;
  return resolveUpdateIdentity({
    runtime,
    version,
    channel: settings.releaseChannel,
    published: resolvePublishedRelease(result),
  });
}

/** What Install and restart does to local agents, read while the surface is shown. */
export function useUpdateRestartLine(enabled: boolean): string {
  const { settings } = useDesktopSettings();
  const { data: daemon } = useFetchQuery({
    queryKey: RESTART_DAEMON_QUERY_KEY,
    queryFn: getDesktopDaemonStatus,
    dataShape: "value",
    enabled: enabled && shouldUseDesktopDaemon(),
    staleTimeMs: 10_000,
    retry: false,
  });
  return formatUpdateRestartEffect(
    resolveUpdateRestartEffect({
      daemon: daemon ?? null,
      keepRunningAfterQuit: settings.daemon.keepRunningAfterQuit,
    }),
  );
}
