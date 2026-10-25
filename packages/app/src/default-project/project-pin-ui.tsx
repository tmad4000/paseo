import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { House, Pin, PinOff } from "lucide-react-native";
import { SidebarSeparator } from "@/components/sidebar/sidebar-separator";
import { HOST_BADGE_ICON_SIZE } from "@/hosts/host-badge";
import { useHostFeatureMap } from "@/runtime/host-features";
import type { Theme } from "@/styles/theme";
import { useProjectPinState } from "./hooks";
import type { HostProjectRef } from "./model";
import { useProjectPinActions } from "./use-project-pin-actions";

const ThemedHouse = withUnistyles(House);
const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const MENU_ICON_SIZE = 14;
const houseMenuIcon = <ThemedHouse size={MENU_ICON_SIZE} uniProps={mutedColor} />;
const pinMenuIcon = <ThemedPin size={MENU_ICON_SIZE} uniProps={mutedColor} />;
const pinOffMenuIcon = <ThemedPinOff size={MENU_ICON_SIZE} uniProps={mutedColor} />;

/**
 * The small marker after a pinned project's name: a house for the Default project, a pin for
 * other pinned projects. Renders nothing for unpinned projects. It reads pin state itself so the
 * memoized project row does not need a new prop.
 */
export function ProjectPinGlyph({ hosts }: { hosts: readonly HostProjectRef[] }) {
  const { t } = useTranslation();
  const state = useProjectPinState(hosts);
  if (!state) return null;
  const label = state.isDefault
    ? t("defaultProject.badges.default")
    : t("defaultProject.badges.pinned");
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={state.isDefault ? "sidebar-project-default-glyph" : "sidebar-project-pinned-glyph"}
      style={styles.glyph}
    >
      {state.isDefault ? (
        <ThemedHouse size={HOST_BADGE_ICON_SIZE} uniProps={mutedColor} />
      ) : (
        <ThemedPin size={HOST_BADGE_ICON_SIZE} uniProps={mutedColor} />
      )}
    </View>
  );
}

/** Separates the pinned project group from the rest; only drawn when both groups have rows. */
export function PinnedProjectsDivider() {
  return (
    <View style={styles.divider} testID="sidebar-pinned-projects-divider">
      <SidebarSeparator />
    </View>
  );
}

export interface ProjectPinMenuItem {
  id: "pin" | "unpin" | "make-default" | "remove-default";
  label: string;
  leading: ReactElement;
  onSelect: () => void;
}

/**
 * The project row menu's pin entries. A Default project offers only "Remove as default project":
 * it is always treated as pinned, so "Unpin" would do nothing visible. Empty when no host in the
 * group supports project pinning, matching how workspace pinning hides on old hosts.
 */
export function useProjectPinMenuItems(hosts: readonly HostProjectRef[]): ProjectPinMenuItem[] {
  const { t } = useTranslation();
  const state = useProjectPinState(hosts);
  const actions = useProjectPinActions();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const support = useHostFeatureMap(serverIds, "projectPinning");
  const supported = serverIds.some((serverId) => support.get(serverId) === true);

  return useMemo(() => {
    if (!supported) return [];
    if (state?.isDefault) {
      return [
        {
          id: "remove-default",
          label: t("defaultProject.actions.removeDefault"),
          leading: houseMenuIcon,
          onSelect: () => actions.setDefault(state.defaultHosts, false),
        },
      ];
    }
    const pinned = state?.pinned === true;
    return [
      pinned
        ? {
            id: "unpin",
            label: t("defaultProject.actions.unpin"),
            leading: pinOffMenuIcon,
            onSelect: () => actions.setPinned(hosts, false),
          }
        : {
            id: "pin",
            label: t("defaultProject.actions.pin"),
            leading: pinMenuIcon,
            onSelect: () => actions.setPinned(hosts, true),
          },
      {
        id: "make-default",
        label: t("defaultProject.actions.makeDefault"),
        leading: houseMenuIcon,
        onSelect: () => actions.setDefault(hosts, true),
      },
    ];
  }, [actions, hosts, state, supported, t]);
}

const styles = StyleSheet.create((theme) => ({
  glyph: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    marginVertical: theme.spacing[1],
  },
}));
