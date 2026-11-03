import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { House, Pin } from "lucide-react-native";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { useHostFeatureMap } from "@/runtime/host-features";
import type { Theme } from "@/styles/theme";
import { useProjectPinState, useProjectPinStates } from "./hooks";
import type { HostProjectRef, ProjectPickerSection, ProjectPinState } from "./model";
import { usePinnedProjectOrderStore } from "./pinned-project-order-store";
import { useProjectPinActions } from "./use-project-pin-actions";

const ThemedHouse = withUnistyles(House);
const ThemedPin = withUnistyles(Pin);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedColor = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const pinnedColor = (theme: Theme) => ({
  color: theme.colors.foreground,
  fill: theme.colors.foreground,
});

const TOGGLE_ICON_SIZE = 14;

export interface ProjectPickerPinOrdering {
  pinStates: ReadonlyMap<string, ProjectPinState>;
  pinnedProjectOrder: readonly string[];
}

/**
 * What a project picker needs to list projects the way the sidebar does: Default first, then
 * pinned projects in the user's drag order, then the rest (see `orderProjectsWithPins`). Pins are
 * the sidebar's project pins, stored on the host, so pinning from a picker shows in the sidebar
 * and the other way round.
 */
export function useProjectPickerPinOrdering(
  projects: readonly { viewKey: string; hosts: readonly HostProjectRef[] }[],
): ProjectPickerPinOrdering {
  const pinStates = useProjectPinStates(projects);
  const pinnedProjectOrder = usePinnedProjectOrderStore((state) => state.pinnedProjectOrder);
  return useMemo(() => ({ pinStates, pinnedProjectOrder }), [pinStates, pinnedProjectOrder]);
}

/** Small label above the first row of a picker section. */
export function ProjectPickerSectionHeader({ section }: { section: ProjectPickerSection }) {
  const { t } = useTranslation();
  return (
    <Text
      style={styles.sectionHeader}
      accessibilityRole="header"
      testID={`project-picker-section-${section}`}
    >
      {section === "pinned"
        ? t("defaultProject.picker.pinnedSection")
        : t("defaultProject.picker.otherSection")}
    </Text>
  );
}

/**
 * Trailing pin control on a picker row. Pressing it pins or unpins without selecting the row.
 * The Default project shows its house marker instead: it is always pinned, so there is nothing to
 * toggle. Renders nothing when no host in the group supports project pinning.
 */
export function ProjectPickerPinToggle({
  hosts,
  projectName,
  testID,
}: {
  hosts: readonly HostProjectRef[];
  projectName: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const state = useProjectPinState(hosts);
  const actions = useProjectPinActions();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const support = useHostFeatureMap(serverIds, "projectPinning");
  const supported = serverIds.some((serverId) => support.get(serverId) === true);
  const pinned = state?.pinned === true;
  const accessibilityState = useMemo(() => ({ selected: pinned }), [pinned]);

  const actionLabel = pinned ? t("defaultProject.actions.unpin") : t("defaultProject.actions.pin");
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      actions.setPinned(hosts, !pinned);
    },
    [actions, hosts, pinned],
  );
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.toggle,
      (compact || isNative) && styles.toggleTouch,
      (hovered || pressed) && styles.toggleActive,
    ],
    [compact],
  );

  if (!supported) return null;
  if (state?.isDefault) {
    return (
      <View
        style={styles.toggle}
        accessible
        accessibilityRole="image"
        accessibilityLabel={t("defaultProject.badges.default")}
        testID={testID ? `${testID}-default` : undefined}
      >
        <ThemedHouse size={TOGGLE_ICON_SIZE} uniProps={mutedColor} />
      </View>
    );
  }
  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          onPress={handlePress}
          style={pressableStyle}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          {...(isWeb ? { "aria-pressed": pinned } : {})}
          accessibilityLabel={`${actionLabel}: ${projectName}`}
          testID={testID}
        >
          <ThemedPin size={TOGGLE_ICON_SIZE} uniProps={pinned ? pinnedColor : extraMutedColor} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="left" offset={8}>
        <Text style={styles.tooltipText}>{actionLabel}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  toggle: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  toggleTouch: { width: 40, height: 40 },
  toggleActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  tooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
