import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { Activity, CircleHelp, Gift, Keyboard } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DiscordIcon } from "@/components/icons/discord-icon";
import { GitHubIcon } from "@/components/icons/github-icon";
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
import { useAppDiagnosticStore } from "@/diagnostics/store";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import {
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { HostProfile } from "@/types/host-connection";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { openChangelog } from "@/changelog";
import { openExternalUrl } from "@/utils/open-external-url";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { resolveVersionStatus, type ReleaseVersionCheck } from "@/desktop/updates/version-status";
import { useHelpUpdateCheck } from "@/desktop/updates/use-help-update-check";

const DISCORD_URL = "https://discord.gg/jz8T2uahpH";
const GITHUB_ISSUE_URL = "https://github.com/getpaseo/paseo/issues/new";
const ThemedActivity = withUnistyles(Activity);
const ThemedCircleHelp = withUnistyles(CircleHelp);
const ThemedGift = withUnistyles(Gift);
const ThemedKeyboard = withUnistyles(Keyboard);
const ThemedDiscordIcon = withUnistyles(DiscordIcon);
const ThemedGitHubIcon = withUnistyles(GitHubIcon);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const diagnosticLeadingIcon = (
  <ThemedActivity size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
);
const shortcutsLeadingIcon = (
  <ThemedKeyboard size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
);
const discordLeadingIcon = (
  <ThemedDiscordIcon size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
);
const githubLeadingIcon = (
  <ThemedGitHubIcon size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
);
const changelogLeadingIcon = (
  <ThemedGift size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
);

function VersionHint({
  version,
  check,
  connected = true,
  label,
  testID,
}: {
  version: string | null;
  check: ReleaseVersionCheck;
  connected?: boolean;
  label: string;
  testID: string;
}) {
  const { t } = useTranslation();
  const status = resolveVersionStatus(version, check, connected);
  return (
    <View style={styles.versionHint} testID={testID}>
      <DropdownMenuHint style={styles.versionRow} trailing={formatVersionWithPrefix(version)}>
        {label}
      </DropdownMenuHint>
      <Text style={styles.versionStatus}>{t(`sidebar.help.versionStatus.${status}`)}</Text>
    </View>
  );
}

function HostVersionHint({ host, check }: { host: HostProfile; check: ReleaseVersionCheck }) {
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = useHostRuntimeSnapshot(host.serverId);
  const daemonVersion = runtime?.client?.getLastServerInfoMessage()?.version ?? null;
  return (
    <VersionHint
      version={daemonVersion}
      check={check}
      connected={isConnected}
      label={host.label}
      testID={`sidebar-help-host-version-${host.serverId}`}
    />
  );
}

export function SidebarHelpMenu() {
  const { t } = useTranslation();
  const shortcutsAvailable = useKeyboardShortcutsAvailable();
  const openAppDiagnostic = useAppDiagnosticStore((state) => state.open);
  const setShortcutsDialogOpen = useKeyboardShortcutsStore((state) => state.setShortcutsDialogOpen);
  const [open, setOpen] = useState(false);
  const version = resolveAppVersion();
  const hosts = useHosts();
  const { settings } = useDesktopSettings();
  const { isDesktopApp, isInstalling, checkForUpdates, installUpdate } = useDesktopAppUpdater();
  const { releaseCheck, canInstall } = useHelpUpdateCheck({
    open,
    isDesktopApp,
    releaseChannel: settings.releaseChannel,
    checkForUpdates,
  });

  const handleInstallUpdate = useCallback(() => {
    void installUpdate();
  }, [installUpdate]);

  const openKeyboardShortcuts = useCallback(() => {
    setShortcutsDialogOpen(true);
  }, [setShortcutsDialogOpen]);

  const openDiscord = useCallback(() => {
    void openExternalUrl(DISCORD_URL);
  }, []);

  const openGitHubIssue = useCallback(() => {
    void openExternalUrl(GITHUB_ISSUE_URL);
  }, []);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={300} enabledOnDesktop={!open}>
        <TooltipTrigger asChild>
          <View>
            <DropdownMenuTrigger
              style={styles.trigger}
              testID="sidebar-help"
              accessibilityRole="button"
              accessibilityLabel={t("sidebar.help.trigger")}
            >
              {({ hovered }) => (
                <ThemedCircleHelp
                  size={ICON_SIZE.md}
                  uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
                />
              )}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{t("sidebar.help.trigger")}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" offset={8} width={280} testID="sidebar-help-menu">
        <DropdownMenuLabel>{t("sidebar.help.sectionHelp")}</DropdownMenuLabel>
        {shortcutsAvailable ? (
          <DropdownMenuItem
            testID="sidebar-help-shortcuts"
            leading={shortcutsLeadingIcon}
            onSelect={openKeyboardShortcuts}
          >
            {t("sidebar.help.shortcuts")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          testID="sidebar-help-changelog"
          leading={changelogLeadingIcon}
          onSelect={openChangelog}
        >
          {t("sidebar.help.whatsNew")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="sidebar-help-diagnostics"
          leading={diagnosticLeadingIcon}
          onSelect={openAppDiagnostic}
        >
          {t("sidebar.help.diagnostics")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("sidebar.help.reportIssue")}</DropdownMenuLabel>
        <DropdownMenuItem
          testID="sidebar-help-discord"
          leading={discordLeadingIcon}
          onSelect={openDiscord}
        >
          {t("sidebar.help.discord")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="sidebar-help-github"
          leading={githubLeadingIcon}
          onSelect={openGitHubIssue}
        >
          {t("sidebar.help.github")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>
          {isDesktopApp
            ? t("sidebar.help.versionsChannel", { channel: settings.releaseChannel })
            : t("sidebar.help.versions")}
        </DropdownMenuLabel>
        <View style={styles.versionList}>
          <VersionHint
            version={version}
            check={releaseCheck}
            label={t("sidebar.help.appName")}
            testID="sidebar-help-version"
          />
          {hosts.map((host) => (
            <HostVersionHint key={host.serverId} host={host} check={releaseCheck} />
          ))}
        </View>
        {isDesktopApp && (canInstall || isInstalling) ? (
          <>
            <Text style={styles.restartWarning}>{t("desktop.updates.callout.restartWarning")}</Text>
            <DropdownMenuItem
              testID="sidebar-help-install-update"
              disabled={isInstalling}
              onSelect={handleInstallUpdate}
            >
              {t(
                isInstalling
                  ? "desktop.updates.callout.installingAction"
                  : "desktop.updates.callout.installAndRestart",
              )}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
  versionList: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
  },
  versionHint: {
    paddingVertical: theme.spacing[1],
  },
  versionRow: {
    paddingVertical: 0,
  },
  versionStatus: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "right",
    paddingHorizontal: theme.spacing[3],
  },
  restartWarning: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
