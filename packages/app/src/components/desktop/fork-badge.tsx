import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { getIsElectronRuntime, HEADER_INNER_HEIGHT, FORK_BADGE_WIDTH } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { useForkUpdateCheck } from "@/desktop/updates/use-fork-update-check";
import { resolveVersionStatus, type ReleaseVersionCheck } from "@/desktop/updates/version-status";
import { getDesktopWindowControlsWidth } from "@/desktop/window-chrome-presentation";
import { useCustomDesktopWindowControls } from "@/utils/desktop-window";
import {
  useHosts,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { resolveAppVersion } from "@/utils/app-version";
import { openChangelog } from "@/changelog";

const CHECKING: ReleaseVersionCheck = { state: "checking" };

export function ForkBadge() {
  if (isNative || !getIsElectronRuntime()) return null;
  return <ForkVersionIndicator />;
}

function HostVersion({ host, check }: { host: HostProfile; check: ReleaseVersionCheck }) {
  const { t } = useTranslation();
  const connected = useHostRuntimeIsConnected(host.serverId);
  const runtime = useHostRuntimeSnapshot(host.serverId);
  const version = runtime?.client?.getLastServerInfoMessage()?.version ?? null;
  const status = resolveVersionStatus(version, check, connected);
  return (
    <View testID={`fork-host-${host.serverId}`}>
      <DropdownMenuHint trailing={formatVersionWithPrefix(version)}>{host.label}</DropdownMenuHint>
      <Text style={styles.detail}>{t(`sidebar.help.versionStatus.${status}`)}</Text>
    </View>
  );
}

function ForkTrigger({
  open,
  label,
  version,
  compactLabel,
  update,
}: {
  open: boolean;
  label: string;
  version: string | null;
  compactLabel: string;
  update: boolean;
}) {
  const triggerStyle = useCallback(
    ({ hovered, pressed }: { hovered: boolean; pressed: boolean }) => [
      styles.trigger,
      (hovered || pressed || open) && styles.triggerActive,
    ],
    [open],
  );
  return (
    <Tooltip enabledOnDesktop={!open} delayDuration={300}>
      <TooltipTrigger asChild>
        <View>
          <DropdownMenuTrigger
            testID="fork-version-trigger"
            accessibilityRole="button"
            accessibilityLabel={label}
            style={triggerStyle}
          >
            <Text style={styles.version} numberOfLines={1}>
              {formatVersionWithPrefix(version)}
            </Text>
            <StatusBadge label={compactLabel} variant={update ? "warning" : "muted"} />
          </DropdownMenuTrigger>
        </View>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function ForkVersionIndicator() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { settings, isLoading } = useDesktopSettings();
  const { check: feedCheck, result, refresh } = useForkUpdateCheck(settings.releaseChannel);
  const check: ReleaseVersionCheck = isLoading ? CHECKING : feedCheck;
  const version = result?.currentVersion ?? resolveAppVersion();
  const status = resolveVersionStatus(version, check);
  const hosts = useHosts();
  const chrome = useCustomDesktopWindowControls();
  const rightInset = chrome.visible && chrome.mode ? getDesktopWindowControlsWidth(chrome.mode) : 0;
  const statusText =
    status === "update" && result?.readyToInstall
      ? t("desktop.fork.ready")
      : t(`sidebar.help.versionStatus.${status}`);
  const label = `${t("desktop.fork.app")} ${formatVersionWithPrefix(version)} · ${statusText}`;

  const checkNow = useCallback(() => {
    void refresh();
  }, [refresh]);
  const compactLabel = t(
    `desktop.fork.compact.${status === "update" && result?.readyToInstall ? "ready" : status}`,
  );

  return (
    <View style={[styles.container, { marginRight: rightInset }]} pointerEvents="box-none">
      <View style={styles.row}>
        <View style={styles.pill}>
          <Text style={styles.label}>FORK</Text>
        </View>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <ForkTrigger
            open={open}
            label={label}
            version={version}
            compactLabel={compactLabel}
            update={status === "update"}
          />
          <DropdownMenuContent
            side="bottom"
            align="end"
            offset={8}
            width={320}
            testID="fork-version-menu"
          >
            <DropdownMenuLabel>{t("desktop.fork.app")}</DropdownMenuLabel>
            <DropdownMenuHint trailing={formatVersionWithPrefix(version)}>
              {t("desktop.fork.installed")}
            </DropdownMenuHint>
            <Text style={styles.detail} testID="fork-app-status">
              {statusText}
            </Text>
            <DropdownMenuHint trailing={settings.releaseChannel}>
              {t("desktop.fork.channel")}
            </DropdownMenuHint>
            {check.state === "checked" ? (
              <DropdownMenuHint trailing={formatVersionWithPrefix(check.latestVersion)}>
                {t("desktop.fork.published")}
              </DropdownMenuHint>
            ) : null}
            <Text style={styles.note}>{t("desktop.fork.idlePolicy")}</Text>
            <DropdownMenuItem
              testID="fork-check-updates"
              disabled={check.state === "checking"}
              onSelect={checkNow}
            >
              {t("desktop.fork.check")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openChangelog}>
              {t("sidebar.help.whatsNew")}
            </DropdownMenuItem>
            {hosts.length ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("desktop.fork.hosts")}</DropdownMenuLabel>
                {hosts.map((host) => (
                  <HostVersion key={host.serverId} host={host} check={check} />
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: 0,
    right: theme.spacing[3],
    height: HEADER_INNER_HEIGHT,
    width: FORK_BADGE_WIDTH,
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 100,
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  triggerActive: { backgroundColor: theme.colors.surface2 },
  version: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, maxWidth: 116 },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  note: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  tooltip: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm },
  pill: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: "#5B21B6",
    borderWidth: theme.borderWidth[1],
    borderColor: "#F59E0B",
  },
  label: { color: "#F59E0B", fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
}));
