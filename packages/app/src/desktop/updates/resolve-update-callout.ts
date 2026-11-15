import type { DesktopAppUpdateStatus } from "@/desktop/updates/use-desktop-app-updater";
import type { UpdateIdentity } from "@/desktop/updates/update-identity";
import { i18n } from "@/i18n/i18next";

export type UpdateCalloutBody =
  | {
      kind: "available";
      versionLabel: string | null;
      identityLine: string | null;
      restartLine: string;
    }
  | { kind: "installing"; identityLine: string | null }
  | { kind: "error"; message: string };

export type UpdateCalloutActionRole = "changelog" | "releaseNotes" | "install" | "retry";

export interface UpdateCalloutActionDescriptor {
  role: UpdateCalloutActionRole;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

export interface UpdateCalloutDescriptor {
  id: "desktop-update";
  dismissalKey: string;
  priority: number;
  title: string;
  body: UpdateCalloutBody;
  releaseNotesUrl: string | null;
  showGiftIcon: boolean;
  variant: "default" | "error";
  actions: UpdateCalloutActionDescriptor[];
  testID: "update-callout";
}

export interface ResolveUpdateCalloutInput {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  isInstalling: boolean;
  availableUpdate: { latestVersion?: string | null } | null;
  errorMessage: string | null;
  /** Product, version, channel and feed of the offered update; null until known. */
  identity: UpdateIdentity | null;
  restartLine: string;
}

function formatVersionLabel(latestVersion: string | null | undefined): string | null {
  if (!latestVersion) return null;
  return `v${latestVersion.replace(/^v/i, "")}`;
}

function resolveActions(input: {
  isError: boolean;
  isInstalling: boolean;
  releaseNotesUrl: string | null;
}): UpdateCalloutActionDescriptor[] {
  const actions: UpdateCalloutActionDescriptor[] = [
    {
      role: input.releaseNotesUrl ? "releaseNotes" : "changelog",
      label: i18n.t("desktop.updates.callout.whatsNew"),
    },
  ];
  if (input.isError) {
    actions.push({ role: "retry", label: i18n.t("common.actions.retry"), variant: "primary" });
    return actions;
  }
  actions.push({
    role: "install",
    label: input.isInstalling
      ? i18n.t("desktop.updates.callout.installingAction")
      : i18n.t("desktop.updates.callout.installAndRestart"),
    variant: "primary",
    disabled: input.isInstalling,
  });
  return actions;
}

export function resolveUpdateCalloutDescriptor(
  input: ResolveUpdateCalloutInput,
): UpdateCalloutDescriptor | null {
  if (!input.isDesktopApp) return null;
  if (input.status !== "available" && input.status !== "installing" && input.status !== "error") {
    return null;
  }

  const isError = input.status === "error";
  const isInstalling = input.isInstalling;
  const isAvailable = !isInstalling && !isError;

  const latestVersion = input.availableUpdate?.latestVersion ?? null;
  const dismissalKey = `desktop-update:${input.status}:${latestVersion ?? "unknown"}`;
  const identityLine = input.identity?.line ?? null;
  const releaseNotesUrl = input.identity?.releaseNotesUrl ?? null;

  let title: string;
  let body: UpdateCalloutBody;
  if (isInstalling) {
    title = i18n.t("desktop.updates.callout.installingTitle");
    body = { kind: "installing", identityLine };
  } else if (isError) {
    title = i18n.t("desktop.updates.callout.failedTitle");
    body = {
      kind: "error",
      message: input.errorMessage ?? i18n.t("desktop.updates.callout.genericError"),
    };
  } else {
    title = i18n.t("desktop.updates.callout.availableTitle");
    body = {
      kind: "available",
      versionLabel: formatVersionLabel(latestVersion),
      identityLine,
      restartLine: input.restartLine,
    };
  }

  const actions = resolveActions({ isError, isInstalling, releaseNotesUrl });

  return {
    id: "desktop-update",
    dismissalKey,
    priority: 200,
    title,
    body,
    releaseNotesUrl,
    showGiftIcon: isAvailable,
    variant: isError ? "error" : "default",
    actions,
    testID: "update-callout",
  };
}
