import { useCallback, useMemo } from "react";
import equal from "fast-deep-equal";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { useDefaultProjectForHost } from "./hooks";
import { useProjectPinActions } from "./use-project-pin-actions";

interface ProjectChoice {
  projectId: string;
  name: string;
}

function useHostProjectChoices(serverId: string): ProjectChoice[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      Array.from(state.sessions[serverId]?.projects.values() ?? [])
        .map((project) => ({
          projectId: project.projectId,
          name: project.projectCustomName ?? project.projectDisplayName,
        }))
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
            left.projectId.localeCompare(right.projectId),
        ),
    equal,
  );
}

function ProjectChoiceItem({
  choice,
  selected,
  onSelect,
}: {
  choice: ProjectChoice | null;
  selected: boolean;
  onSelect: (choice: ProjectChoice | null) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(choice), [choice, onSelect]);
  return (
    <DropdownMenuItem
      selected={selected}
      onSelect={handleSelect}
      testID={`default-project-option-${choice?.projectId ?? "none"}`}
    >
      {choice?.name ?? t("defaultProject.settings.none")}
    </DropdownMenuItem>
  );
}

/**
 * The host's Default project picker. It lives on the host's Workspaces settings page because the
 * Default project is per host and stored on that host, unlike the per-device Sidebar settings.
 */
export function DefaultProjectSettingsCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const supported = useHostFeature(serverId, "projectPinning");
  const current = useDefaultProjectForHost(serverId);
  const choices = useHostProjectChoices(serverId);
  const actions = useProjectPinActions();
  const selectedLabel = current?.displayName ?? t("defaultProject.settings.none");

  const handleSelect = useCallback(
    (choice: ProjectChoice | null) => {
      if (choice) {
        if (choice.projectId !== current?.projectId) {
          actions.setDefault([{ serverId, projectId: choice.projectId }], true);
        }
        return;
      }
      if (current) actions.setDefault([{ serverId, projectId: current.projectId }], false);
    },
    [actions, current, serverId],
  );

  const items = useMemo(
    () => [null, ...choices],
    [choices],
  );

  return (
    <View style={settingsStyles.card} testID="host-page-default-project-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("defaultProject.settings.title")}</Text>
          <Text style={settingsStyles.rowHint}>
            {supported ? t("defaultProject.settings.hint") : t("defaultProject.settings.updateHost")}
          </Text>
        </View>
        {supported ? (
          <DropdownMenu>
            <DropdownTrigger
              testID="host-page-default-project-trigger"
              accessibilityRole="button"
              accessibilityLabel={t("defaultProject.settings.accessibilityLabel", {
                value: selectedLabel,
              })}
            >
              {selectedLabel}
            </DropdownTrigger>
            <DropdownMenuContent
              side="bottom"
              align="end"
              width={260}
              maxHeight={360}
              scrollable
              sheetTitle={t("defaultProject.settings.title")}
            >
              {items.map((choice) => (
                <ProjectChoiceItem
                  key={choice?.projectId ?? "none"}
                  choice={choice}
                  selected={(choice?.projectId ?? null) === (current?.projectId ?? null)}
                  onSelect={handleSelect}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </View>
    </View>
  );
}
