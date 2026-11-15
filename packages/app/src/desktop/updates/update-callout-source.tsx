import { Gift } from "lucide-react-native";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useUnistyles } from "react-native-unistyles";
import {
  type SidebarCalloutAction,
  SidebarCalloutDescriptionText,
} from "@/components/sidebar-callout";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import {
  resolveUpdateCalloutDescriptor,
  type UpdateCalloutActionDescriptor,
  type UpdateCalloutBody,
} from "@/desktop/updates/resolve-update-callout";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { useUpdateIdentity, useUpdateRestartLine } from "@/desktop/updates/use-update-identity";
import { useStableEvent } from "@/hooks/use-stable-event";
import { openChangelog } from "@/changelog";
import { openExternalUrl } from "@/utils/open-external-url";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function renderBody(body: UpdateCalloutBody, t: ReturnType<typeof useTranslation>["t"]): ReactNode {
  if (body.kind === "error") return body.message;
  if (body.kind === "installing") {
    return (
      <>
        {body.identityLine ? (
          <SidebarCalloutDescriptionText>{body.identityLine}</SidebarCalloutDescriptionText>
        ) : null}
        <SidebarCalloutDescriptionText>
          {t("desktop.updates.callout.installingDescription")}
        </SidebarCalloutDescriptionText>
      </>
    );
  }
  return <UpdateAvailableDescription body={body} t={t} />;
}

function materializeActions(
  actions: readonly UpdateCalloutActionDescriptor[],
  handlers: Record<UpdateCalloutActionDescriptor["role"], () => void>,
): SidebarCalloutAction[] {
  return actions.map((action) => ({
    label: action.label,
    onPress: handlers[action.role],
    variant: action.variant,
    disabled: action.disabled,
  }));
}

export function UpdateCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const { theme } = useUnistyles();
  const {
    isDesktopApp,
    status,
    availableUpdate,
    errorMessage,
    checkForUpdates,
    installUpdate,
    isInstalling,
  } = useDesktopAppUpdater();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isShown = status === "available" || status === "installing" || status === "error";
  const identity = useUpdateIdentity(availableUpdate?.latestVersion, availableUpdate);
  const restartLine = useUpdateRestartLine(isDesktopApp && isShown);

  const install = useStableEvent(() => {
    void installUpdate();
  });
  const retry = useStableEvent(() => {
    void checkForUpdates();
  });
  useEffect(() => {
    if (!isDesktopApp) return;

    void checkForUpdates({ intent: "automatic", silent: true });

    intervalRef.current = setInterval(() => {
      void checkForUpdates({ intent: "automatic", silent: true });
    }, CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isDesktopApp, checkForUpdates]);

  useEffect(() => {
    const descriptor = resolveUpdateCalloutDescriptor({
      isDesktopApp,
      status,
      isInstalling,
      availableUpdate,
      errorMessage,
      identity,
      restartLine,
    });
    if (!descriptor) return;
    const { releaseNotesUrl } = descriptor;

    return callouts.show({
      id: descriptor.id,
      dismissalKey: descriptor.dismissalKey,
      priority: descriptor.priority,
      title: descriptor.title,
      description: renderBody(descriptor.body, t),
      icon: descriptor.showGiftIcon ? (
        <Gift size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      ) : undefined,
      variant: descriptor.variant,
      actions: materializeActions(descriptor.actions, {
        changelog: openChangelog,
        releaseNotes: () => {
          if (releaseNotesUrl) void openExternalUrl(releaseNotesUrl);
        },
        install,
        retry,
      }),
      testID: descriptor.testID,
    });
  }, [
    availableUpdate,
    callouts,
    errorMessage,
    identity,
    install,
    isDesktopApp,
    isInstalling,
    restartLine,
    retry,
    status,
    theme.colors.foregroundMuted,
    theme.iconSize.sm,
    t,
  ]);

  return null;
}

function UpdateAvailableDescription({
  body,
  t,
}: {
  body: Extract<UpdateCalloutBody, { kind: "available" }>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  let readyLine = t("desktop.updates.callout.newVersionReady");
  if (body.identityLine) readyLine = body.identityLine;
  else if (body.versionLabel) {
    readyLine = t("desktop.updates.callout.versionReady", { version: body.versionLabel });
  }
  return (
    <>
      <SidebarCalloutDescriptionText>{readyLine}</SidebarCalloutDescriptionText>
      <SidebarCalloutDescriptionText>{body.restartLine}</SidebarCalloutDescriptionText>
    </>
  );
}
