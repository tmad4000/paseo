import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Shortcut } from "@/components/ui/shortcut";
import { isWeb } from "@/constants/platform";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { PanelIconProps } from "@/panels/panel-registry";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useTabLocalSplitsStore } from "@/stores/tab-local-splits-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { awaitNewTab, chooseExistingTab, dismissChooser } from "@/tab-local-splits/commands";
import type { TabLocalPendingKind } from "@/tab-local-splits/normalize";
import {
  useWorkspaceTabLaunchCatalog,
  type WorkspaceTabLaunchItem,
} from "@/workspace-tabs/launcher";

/** A tab the chooser can pull in; `groupedUnder` is the composite that holds it today. */
export interface TabLocalCandidate {
  tab: WorkspaceTabDescriptor;
  groupedUnder: WorkspaceTabDescriptor | null;
}

interface TabLocalChooserProps {
  workspaceKey: string;
  paneId: string;
  hostTabId: string;
  chooserId: string;
  serverId: string;
  workspaceId: string;
  candidates: readonly TabLocalCandidate[];
  isFocused: boolean;
}

const ROW_DATA_SET = { tabLocalChooserRow: "true" };
const ROW_SELECTOR = '[data-tab-local-chooser-row="true"]';
const NEW_TAB_KINDS: Record<string, TabLocalPendingKind> = {
  agent: "draft",
  terminal: "terminal",
  browser: "browser",
};
const NEW_TAB_LABEL_KEYS = {
  agent: "workspace.tabs.actions.newAgent",
  terminal: "workspace.tabs.actions.newTerminal",
  browser: "workspace.tabs.actions.newBrowser",
} as const;
const ESC_CHORD = [["Esc"]];

function isNewTabItemId(id: string): id is keyof typeof NEW_TAB_LABEL_KEYS {
  return id in NEW_TAB_LABEL_KEYS;
}
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function RowIcon({
  Icon,
  color = "",
}: {
  Icon: React.ComponentType<PanelIconProps>;
  color?: string;
}) {
  return <Icon size={ICON_SIZE.sm} color={color} />;
}

const ThemedRowIcon = withUnistyles(RowIcon);

function rowStyle({
  pressed,
  hovered = false,
  focused = false,
}: PressableStateCallbackType & { hovered?: boolean; focused?: boolean }) {
  return [styles.row, (hovered || focused) && styles.rowHovered, pressed && styles.rowPressed];
}

function RowShortcut({ actionId }: { actionId: string }) {
  const keys = useShortcutKeys(actionId);
  return keys ? <Shortcut chord={keys} /> : null;
}

function CandidateRow({
  candidate,
  serverId,
  workspaceId,
  onChoose,
}: {
  candidate: TabLocalCandidate;
  serverId: string;
  workspaceId: string;
  onChoose: (tabId: string) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(
    () => onChoose(candidate.tab.tabId),
    [candidate.tab.tabId, onChoose],
  );
  return (
    <WorkspaceTabPresentationResolver
      tab={candidate.tab}
      serverId={serverId}
      workspaceId={workspaceId}
    >
      {(presentation) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={presentation.label}
          dataSet={ROW_DATA_SET}
          onPress={handlePress}
          style={rowStyle}
          testID={`tab-local-chooser-existing-${candidate.tab.tabId}`}
        >
          <View style={styles.rowIcon}>
            <WorkspaceTabIcon presentation={presentation} size={ICON_SIZE.sm} backdrop="surface0" />
          </View>
          <Text numberOfLines={1} style={styles.rowLabel}>
            {presentation.label}
          </Text>
          {candidate.groupedUnder ? (
            <WorkspaceTabPresentationResolver
              tab={candidate.groupedUnder}
              serverId={serverId}
              workspaceId={workspaceId}
            >
              {(host) => (
                <Text numberOfLines={1} style={styles.rowHint}>
                  {t("workspace.tabs.actions.tabLocal.inTab", { title: host.label })}
                </Text>
              )}
            </WorkspaceTabPresentationResolver>
          ) : null}
        </Pressable>
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function NewTabRow({
  item,
  onLaunch,
}: {
  item: WorkspaceTabLaunchItem;
  onLaunch: (item: WorkspaceTabLaunchItem) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onLaunch(item), [item, onLaunch]);
  const label = isNewTabItemId(item.id) ? t(NEW_TAB_LABEL_KEYS[item.id]) : item.label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      dataSet={ROW_DATA_SET}
      disabled={item.disabled}
      onPress={handlePress}
      style={rowStyle}
      testID={`tab-local-chooser-new-${item.id}`}
    >
      <View style={styles.rowIcon}>
        {item.Icon ? <ThemedRowIcon Icon={item.Icon} uniProps={mutedColorMapping} /> : null}
      </View>
      <Text numberOfLines={1} style={styles.rowLabel}>
        {label}
      </Text>
      {item.shortcutActionId ? <RowShortcut actionId={item.shortcutActionId} /> : null}
    </Pressable>
  );
}

/** Wires arrow keys, Enter and Esc inside the chooser, like the empty-pane launcher. */
function useChooserKeyboard(input: { isFocused: boolean; onCancel: () => void }) {
  const containerRef = useRef<View | null>(null);
  const { isFocused, onCancel } = input;
  useEffect(() => {
    if (!isWeb || !isFocused) return;
    const container: unknown = containerRef.current;
    if (!(container instanceof HTMLElement)) return;
    const element = container;
    const rows = () => Array.from(element.querySelectorAll<HTMLElement>(ROW_SELECTOR));
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      const available = rows();
      const currentIndex = available.findIndex((row) => row === document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const start = currentIndex < 0 && delta < 0 ? 0 : currentIndex;
        available[(start + delta + available.length) % available.length]?.focus();
      }
      if (event.key === "Enter" && currentIndex >= 0) {
        event.preventDefault();
        available[currentIndex]?.click();
      }
    }
    element.addEventListener("keydown", handleKeyDown);
    rows()[0]?.focus({ preventScroll: true });
    return () => element.removeEventListener("keydown", handleKeyDown);
  }, [isFocused, onCancel]);
  return containerRef;
}

/**
 * The content of a new leaf: an existing tab of this pane, or a new terminal, agent or browser
 * through the normal launcher. Nothing is created until a row is chosen.
 */
export function TabLocalChooser({
  workspaceKey,
  paneId,
  hostTabId,
  chooserId,
  serverId,
  workspaceId,
  candidates,
  isFocused,
}: TabLocalChooserProps) {
  const { t } = useTranslation();
  const groups = useWorkspaceTabLaunchCatalog({ serverId, purpose: "primary", host: "main" });
  const newTabItems = useMemo(
    () =>
      groups
        .flatMap((group) => (group.id === "tabs" ? group.items : []))
        .filter((item) => item.id in NEW_TAB_KINDS),
    [groups],
  );
  const awaiting = useTabLocalSplitsStore((state) =>
    (state.pendingFillsByWorkspace[workspaceKey] ?? []).some(
      (fill) => fill.chooserId === chooserId,
    ),
  );
  const handleCancel = useCallback(
    () => dismissChooser({ workspaceKey, hostTabId, chooserId }),
    [chooserId, hostTabId, workspaceKey],
  );
  const handleChoose = useCallback(
    (tabId: string) => chooseExistingTab({ workspaceKey, hostTabId, chooserId, tabId }),
    [chooserId, hostTabId, workspaceKey],
  );
  const handleLaunch = useCallback(
    (item: WorkspaceTabLaunchItem) => {
      const kind = NEW_TAB_KINDS[item.id];
      if (!kind) return;
      awaitNewTab({ workspaceKey, hostTabId, chooserId, kind });
      item.launch({ kind: "open", paneId });
    },
    [chooserId, hostTabId, paneId, workspaceKey],
  );
  const containerRef = useChooserKeyboard({ isFocused, onCancel: handleCancel });

  return (
    <View ref={containerRef} style={styles.container} testID={`tab-local-chooser-${chooserId}`}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.list}>
          <Text style={styles.title}>{t("workspace.tabs.actions.tabLocal.chooserTitle")}</Text>
          {awaiting ? (
            <Text style={styles.sectionLabel}>{t("workspace.tabs.actions.tabLocal.opening")}</Text>
          ) : null}
          <Text style={styles.sectionLabel}>
            {t("workspace.tabs.actions.tabLocal.existingTab")}
          </Text>
          {candidates.length === 0 ? (
            <Text style={styles.emptyLabel}>
              {t("workspace.tabs.actions.tabLocal.noExistingTabs")}
            </Text>
          ) : null}
          {candidates.map((candidate) => (
            <CandidateRow
              key={candidate.tab.tabId}
              candidate={candidate}
              serverId={serverId}
              workspaceId={workspaceId}
              onChoose={handleChoose}
            />
          ))}
          <View style={styles.separator} />
          {newTabItems.map((item) => (
            <NewTabRow key={item.id} item={item} onLaunch={handleLaunch} />
          ))}
          <View style={styles.separator} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspace.tabs.actions.tabLocal.cancel")}
            dataSet={ROW_DATA_SET}
            onPress={handleCancel}
            style={rowStyle}
            testID="tab-local-chooser-cancel"
          >
            <View style={styles.rowIcon} />
            <Text numberOfLines={1} style={styles.rowLabel}>
              {t("workspace.tabs.actions.tabLocal.cancel")}
            </Text>
            <Shortcut chord={ESC_CHORD} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 12,
  },
  list: {
    width: "100%",
    maxWidth: 280,
    gap: 2,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[0.5],
  },
  emptyLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    opacity: 0.8,
  },
  rowIcon: {
    width: ICON_SIZE.sm,
    alignItems: "center",
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowHint: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  separator: {
    height: 1,
    marginVertical: theme.spacing[1],
    backgroundColor: theme.colors.borderAccent,
  },
}));
