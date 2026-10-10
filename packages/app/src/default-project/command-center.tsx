import { useCallback, useMemo } from "react";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { House, Pin, PinOff } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type {
  CommandCenterContribution,
  CommandCenterIconProps,
} from "@/command-center/contributions";
import { useCommandCenterActions } from "@/command-center/provider";
import { useHostFeature } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { selectDefaultProjectForHost, useDefaultProjectForHost, useProjectPinState } from "./hooks";
import { resolveDefaultProjectWorkspaceId, type HostProjectRef } from "./model";
import { useProjectPinActions } from "./use-project-pin-actions";

const ThemedHouse = withUnistyles(House, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedPin = withUnistyles(Pin, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedPinOff = withUnistyles(PinOff, (theme) => ({ color: theme.colors.foregroundMuted }));

function HouseIcon({ size }: CommandCenterIconProps) {
  return <ThemedHouse size={size} strokeWidth={2.2} />;
}

function PinIcon({ size }: CommandCenterIconProps) {
  return <ThemedPin size={size} strokeWidth={2.2} />;
}

function PinOffIcon({ size }: CommandCenterIconProps) {
  return <ThemedPinOff size={size} strokeWidth={2.2} />;
}

/** Opens the Default project's most recent workspace, or its New workspace screen if it has none. */
export function openDefaultProject(serverId: string): boolean {
  const state = useSessionStore.getState();
  const project = selectDefaultProjectForHost(state, serverId);
  const session = state.sessions[serverId];
  if (!project || !session) return false;
  const lastActivityAtByWorkspaceId = new Map<string, Date>();
  for (const [workspaceId, activity] of session.workspaceAgentActivity) {
    lastActivityAtByWorkspaceId.set(workspaceId, activity.lastActivityAt);
  }
  const workspaceId = resolveDefaultProjectWorkspaceId({
    projectId: project.projectId,
    workspaces: session.workspaces.values(),
    lastActivityAtByWorkspaceId,
  });
  if (workspaceId) {
    navigateToWorkspace({ serverId, workspaceId });
    return true;
  }
  router.navigate(
    buildNewWorkspaceRoute({
      serverId,
      sourceDirectory: project.rootPath,
      displayName: project.displayName,
      projectId: project.projectId,
    }) as Href,
  );
  return true;
}

/** Host whose Default project "Go to default project" opens: the active host, else the first. */
function useDefaultProjectHostId(activeServerId: string | null): string | null {
  const hosts = useHosts();
  const activeDefault = useDefaultProjectForHost(activeServerId);
  const fallbackServerId = useSessionStore((state) => {
    for (const host of hosts) {
      if (selectDefaultProjectForHost(state, host.serverId)) return host.serverId;
    }
    return null;
  });
  return activeDefault ? activeServerId : fallbackServerId;
}

export function useDefaultProjectCommandCenterActions(): void {
  const { t } = useTranslation();
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const projectId = useWorkspaceFields(
    serverId,
    selection?.workspaceId ?? null,
    (workspace) => workspace.projectId,
  );
  const currentHosts = useMemo<HostProjectRef[]>(
    () => (serverId && projectId ? [{ serverId, projectId }] : []),
    [projectId, serverId],
  );
  const canPin = useHostFeature(serverId, "projectPinning");
  const pinState = useProjectPinState(currentHosts);
  const actions = useProjectPinActions();
  const defaultHostId = useDefaultProjectHostId(serverId);
  const defaultProjectName = useDefaultProjectForHost(defaultHostId)?.displayName ?? null;
  const defaultProjectNameKeywords = useMemo(
    () => (defaultProjectName ? [defaultProjectName] : []),
    [defaultProjectName],
  );

  const goToDefault = useCallback(() => {
    if (!defaultHostId) return;
    clearCommandCenterFocusRestoreElement();
    openDefaultProject(defaultHostId);
  }, [defaultHostId]);

  const contributions = useMemo<CommandCenterContribution[]>(() => {
    const sectionTitle = t("shell.commandCenter.actions");
    const list: CommandCenterContribution[] = [];
    if (defaultHostId) {
      list.push({
        id: "go-to-default-project",
        group: "actions",
        groupRank: 0,
        rank: 40,
        keywords: ["default", "project", "home", "go", ...defaultProjectNameKeywords],
        visibility: "always",
        run: goToDefault,
        presentation: {
          kind: "action",
          title: t("defaultProject.commandCenter.goToDefault"),
          sectionTitle,
          icon: HouseIcon,
        },
      });
    }
    if (!canPin || currentHosts.length === 0) return list;
    const keywords = ["pin", "unpin", "default", "project", "favorite"];
    if (pinState?.isDefault) {
      list.push({
        id: "remove-current-default",
        group: "actions",
        groupRank: 0,
        rank: 41,
        keywords,
        visibility: "query",
        run: () => actions.setDefault(currentHosts, false),
        presentation: {
          kind: "action",
          title: t("defaultProject.commandCenter.removeCurrentDefault"),
          sectionTitle,
          icon: HouseIcon,
        },
      });
      return list;
    }
    const pinned = pinState?.pinned === true;
    list.push(
      {
        id: "toggle-current-project-pin",
        group: "actions",
        groupRank: 0,
        rank: 41,
        keywords,
        visibility: "query",
        run: () => actions.setPinned(currentHosts, !pinned),
        presentation: {
          kind: "action",
          title: pinned
            ? t("defaultProject.commandCenter.unpinCurrent")
            : t("defaultProject.commandCenter.pinCurrent"),
          sectionTitle,
          icon: pinned ? PinOffIcon : PinIcon,
        },
      },
      {
        id: "make-current-project-default",
        group: "actions",
        groupRank: 0,
        rank: 42,
        keywords,
        visibility: "query",
        run: () => actions.setDefault(currentHosts, true),
        presentation: {
          kind: "action",
          title: t("defaultProject.commandCenter.makeCurrentDefault"),
          sectionTitle,
          icon: HouseIcon,
        },
      },
    );
    return list;
  }, [
    actions,
    canPin,
    currentHosts,
    defaultHostId,
    defaultProjectNameKeywords,
    goToDefault,
    pinState,
    t,
  ]);

  useCommandCenterActions({
    sourceId: "default-project",
    enabled: contributions.length > 0,
    actions: contributions,
  });
}

export function CommandCenterDefaultProjectActions() {
  useDefaultProjectCommandCenterActions();
  return null;
}
