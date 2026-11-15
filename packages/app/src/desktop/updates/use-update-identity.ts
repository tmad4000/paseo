import { useFetchQuery } from "@/data/query";
import {
  getDesktopDaemonStatus,
  shouldUseDesktopDaemon,
  type DesktopDaemonStatus,
} from "@/desktop/daemon/desktop-daemon";
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
  type UpdateIdentityRole,
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
  role: UpdateIdentityRole,
  version: string | null | undefined,
  result: Pick<DesktopAppUpdateCheckResult, "publishedVersion" | "publishedTag"> | null,
): UpdateIdentity | null {
  const { settings } = useDesktopSettings();
  const runtime = useDesktopRuntimeInfo();
  if (!runtime || !version) return null;
  return resolveUpdateIdentity({
    runtime,
    role,
    version,
    channel: settings.releaseChannel,
    published: resolvePublishedRelease(result),
  });
}

const RESTART_DAEMON_REFRESH_MS = 30_000;

export interface UpdateRestartLine {
  line: string;
  /** Re-reads daemon ownership; call right before acting on the line. */
  refresh(): Promise<string>;
}

/** What Install and restart does to local agents, kept fresh while the surface is shown. */
export function useUpdateRestartLine(enabled: boolean): UpdateRestartLine {
  const { settings } = useDesktopSettings();
  const isEnabled = enabled && shouldUseDesktopDaemon();
  const { data: daemon, refetch } = useFetchQuery({
    queryKey: RESTART_DAEMON_QUERY_KEY,
    queryFn: getDesktopDaemonStatus,
    dataShape: "value",
    enabled: isEnabled,
    staleTimeMs: 0,
    refetchInterval: isEnabled ? RESTART_DAEMON_REFRESH_MS : false,
    retry: false,
  });
  const { keepRunningAfterQuit } = settings.daemon;
  function format(status: DesktopDaemonStatus | null): string {
    return formatUpdateRestartEffect(
      resolveUpdateRestartEffect({ daemon: status, keepRunningAfterQuit }),
    );
  }
  return {
    line: format(daemon ?? null),
    refresh: async () => format((await refetch()).data ?? null),
  };
}
