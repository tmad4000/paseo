import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { Ellipsis, Maximize2, Minimize2, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ResizeHandle } from "@/components/resize-handle";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Shortcut } from "@/components/ui/shortcut";
import { isWeb } from "@/constants/platform";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import {
  WorkspacePaneContent,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { compositeKey, useTabLocalSplitsStore } from "@/stores/tab-local-splits-store";
import type { Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { TabLocalChooser, type TabLocalCandidate } from "@/tab-local-splits/chooser";
import {
  focusTabLocalLeaf,
  moveLeafToOwnTab,
  resizeTabLocalSplit,
  toggleTabLocalZoom,
} from "@/tab-local-splits/commands";
import {
  computeTabLocalFrames,
  type TabLocalDividerFrame,
  type TabLocalRect,
} from "@/tab-local-splits/geometry";
import type { TabLocalLayout, TabLocalLeaf, TabLocalNode } from "@/tab-local-splits/model";
import { collectLeaves, leafIdOf } from "@/tab-local-splits/model";

const ThemedX = withUnistyles(X);
const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedMaximize = withUnistyles(Maximize2);
const ThemedMinimize = withUnistyles(Minimize2);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const LEAF_HEADER_HEIGHT = 24;
const FULL_RECT: TabLocalRect = { left: 0, top: 0, width: 1, height: 1 };

export interface TabLocalSplitViewProps {
  workspaceKey: string;
  paneId: string;
  layout: TabLocalLayout;
  tabsById: ReadonlyMap<string, WorkspaceTabDescriptor>;
  candidates: readonly TabLocalCandidate[];
  serverId: string;
  workspaceId: string;
  isWorkspaceFocused: boolean;
  /** The pane is focused and this composite is its visible tab. */
  interactive: boolean;
  buildPaneContentModel: (input: {
    paneId: string;
    tab: WorkspaceTabDescriptor;
  }) => WorkspacePaneContentModel;
  onFocusPane: (paneId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
}

interface ContainerSize {
  width: number;
  height: number;
}

function percent(value: number): `${number}%` {
  return `${value * 100}%`;
}

function rectStyle(rect: TabLocalRect, hidden: boolean) {
  return inlineUnistylesStyle({
    left: percent(rect.left),
    top: percent(rect.top),
    width: percent(rect.width),
    height: percent(rect.height),
    display: hidden ? ("none" as const) : ("flex" as const),
  });
}

function dividerStyle(divider: TabLocalDividerFrame) {
  const { groupRect } = divider;
  return inlineUnistylesStyle(
    divider.direction === "horizontal"
      ? {
          left: percent(divider.offset),
          top: percent(groupRect.top),
          height: percent(groupRect.height),
          width: 1,
          flexDirection: "row" as const,
        }
      : {
          top: percent(divider.offset),
          left: percent(groupRect.left),
          width: percent(groupRect.width),
          height: 1,
        },
  );
}

function applyPreviewSizes(node: TabLocalNode, preview: Record<string, number[]>): TabLocalNode {
  if (node.kind !== "group") {
    return node;
  }
  return {
    ...node,
    sizes: preview[node.id] ?? node.sizes,
    children: node.children.map((child) => applyPreviewSizes(child, preview)),
  };
}

/**
 * A press inside a leaf focuses it (web only). Focus events are not used: panels focus
 * themselves on mount and reload, and that must not take the leaf focus back from a deep link
 * or a focus-direction shortcut that just chose another leaf.
 */
function useLeafPressTracking(onPress: () => void) {
  const ref = useRef<View | null>(null);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  useEffect(() => {
    if (!isWeb) return;
    const raw: unknown = ref.current;
    if (!(raw instanceof HTMLElement)) return;
    const element = raw;
    const handlePointerDown = () => onPressRef.current();
    element.addEventListener("pointerdown", handlePointerDown, true);
    return () => element.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);
  return ref;
}

function LeafHeaderActions({
  isZoomed,
  canMoveToOwnTab,
  testIdBase,
  onToggleZoom,
  onClose,
  onMoveToOwnTab,
}: {
  isZoomed: boolean;
  canMoveToOwnTab: boolean;
  testIdBase: string;
  onToggleZoom: () => void;
  onClose: () => void;
  onMoveToOwnTab: () => void;
}) {
  const { t } = useTranslation();
  const zoomKeys = useShortcutKeys("workspace-tab-zoom-leaf");
  return (
    <View style={styles.headerActions}>
      {isZoomed ? (
        <View style={styles.zoomedHint}>
          <Text style={styles.zoomedText}>{t("workspace.tabs.actions.tabLocal.zoomed")}</Text>
          {zoomKeys ? <Shortcut chord={zoomKeys} /> : null}
        </View>
      ) : null}
      <ToolbarButton
        compact
        label={t(
          isZoomed
            ? "workspace.tabs.actions.tabLocal.restoreLeaf"
            : "workspace.tabs.actions.tabLocal.zoomLeaf",
        )}
        shortcut={zoomKeys}
        selected={isZoomed}
        testID={`${testIdBase}-zoom`}
        onPress={onToggleZoom}
      >
        {isZoomed ? (
          <ThemedMinimize size={12} uniProps={mutedColorMapping} />
        ) : (
          <ThemedMaximize size={12} uniProps={mutedColorMapping} />
        )}
      </ToolbarButton>
      <ToolbarButton
        compact
        label={t("workspace.tabs.actions.tabLocal.closeLeaf")}
        testID={`${testIdBase}-close`}
        onPress={onClose}
      >
        <ThemedX size={12} uniProps={mutedColorMapping} />
      </ToolbarButton>
      {canMoveToOwnTab ? (
        <DropdownMenu>
          <ToolbarButton
            compact
            kind="menu"
            label={t("workspace.tabs.actions.tabLocal.leafMenu")}
            testID={`${testIdBase}-menu`}
          >
            <ThemedEllipsis size={12} uniProps={mutedColorMapping} />
          </ToolbarButton>
          <DropdownMenuContent side="bottom" align="end" offset={4} width={200}>
            <DropdownMenuItem testID={`${testIdBase}-move-to-own-tab`} onSelect={onMoveToOwnTab}>
              {t("workspace.tabs.actions.tabLocal.moveToOwnTab")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </View>
  );
}

interface LeafSlotProps {
  leaf: TabLocalLeaf;
  rect: TabLocalRect;
  hidden: boolean;
  isFocused: boolean;
  isZoomed: boolean;
  composite: TabLocalSplitViewProps;
}

function LeafSlot({ leaf, rect, hidden, isFocused, isZoomed, composite }: LeafSlotProps) {
  const { t } = useTranslation();
  const { workspaceKey, paneId, layout, onFocusPane } = composite;
  const leafId = leafIdOf(leaf);
  const hostTabId = layout.hostTabId;
  const handleFocus = useCallback(() => {
    focusTabLocalLeaf({ workspaceKey, hostTabId, leafId });
    onFocusPane(paneId);
  }, [hostTabId, leafId, onFocusPane, paneId, workspaceKey]);
  const slotRef = useLeafPressTracking(handleFocus);
  // A panel reports focus when it focuses itself (a terminal on mount). That keeps the pane
  // focused but must not move the leaf focus, which presses and keyboard moves own.
  const handleFocusPane = useCallback(() => onFocusPane(paneId), [onFocusPane, paneId]);
  const handleToggleZoom = useCallback(() => {
    focusTabLocalLeaf({ workspaceKey, hostTabId, leafId });
    toggleTabLocalZoom({ workspaceKey, hostTabId });
  }, [hostTabId, leafId, workspaceKey]);
  const tab = leaf.kind === "leaf" ? composite.tabsById.get(leaf.tabId) : undefined;
  const testIdBase = `tab-local-leaf-${leafId}`;

  return (
    <View
      ref={slotRef}
      collapsable={false}
      style={[styles.slot, rectStyle(rect, hidden)]}
      testID={testIdBase}
      dataSet={LEAF_DATA_SET}
    >
      <RetainedPanelActivity active={!hidden}>
        {leaf.kind === "chooser" ? (
          <ChooserLeaf composite={composite} chooserId={leaf.id} isFocused={isFocused} />
        ) : null}
        {tab ? (
          <TabLeaf
            tab={tab}
            composite={composite}
            isFocused={isFocused}
            isZoomed={isZoomed}
            testIdBase={testIdBase}
            onToggleZoom={handleToggleZoom}
            onFocusPane={handleFocusPane}
          />
        ) : null}
        {leaf.kind === "leaf" && !tab ? (
          <Text style={styles.title}>{t("common.states.loading")}</Text>
        ) : null}
      </RetainedPanelActivity>
    </View>
  );
}

const LEAF_DATA_SET = { tabLocalLeaf: "true" };

function ChooserLeaf({
  composite,
  chooserId,
  isFocused,
}: {
  composite: TabLocalSplitViewProps;
  chooserId: string;
  isFocused: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.header}>
        <Text numberOfLines={1} style={isFocused ? styles.titleFocused : styles.title}>
          {t("workspace.tabs.actions.tabLocal.chooserTitle")}
        </Text>
      </View>
      <View style={styles.body}>
        <TabLocalChooser
          workspaceKey={composite.workspaceKey}
          paneId={composite.paneId}
          hostTabId={composite.layout.hostTabId}
          chooserId={chooserId}
          serverId={composite.serverId}
          workspaceId={composite.workspaceId}
          candidates={composite.candidates}
          isFocused={isFocused && composite.interactive}
        />
      </View>
    </>
  );
}

function TabLeaf({
  tab,
  composite,
  isFocused,
  isZoomed,
  testIdBase,
  onToggleZoom,
  onFocusPane,
}: {
  tab: WorkspaceTabDescriptor;
  composite: TabLocalSplitViewProps;
  isFocused: boolean;
  isZoomed: boolean;
  testIdBase: string;
  onToggleZoom: () => void;
  onFocusPane: () => void;
}) {
  const { workspaceKey, paneId, layout, buildPaneContentModel, onCloseTab } = composite;
  const content = useMemo(
    () => buildPaneContentModel({ paneId, tab }),
    [buildPaneContentModel, paneId, tab],
  );
  const handleClose = useCallback(() => void onCloseTab(tab.tabId), [onCloseTab, tab.tabId]);
  const handleMoveToOwnTab = useCallback(
    () => moveLeafToOwnTab({ workspaceKey, hostTabId: layout.hostTabId, tabId: tab.tabId }),
    [layout.hostTabId, tab.tabId, workspaceKey],
  );
  return (
    <>
      <View style={styles.header}>
        <WorkspaceTabPresentationResolver
          tab={tab}
          serverId={tab.scope?.serverId ?? composite.serverId}
          workspaceId={tab.scope?.workspaceId ?? composite.workspaceId}
        >
          {(presentation) => (
            <View style={styles.headerTitle}>
              <WorkspaceTabIcon
                presentation={presentation}
                active={isFocused}
                size={14}
                backdrop="surface0"
              />
              <Text
                numberOfLines={1}
                style={isFocused ? styles.titleFocused : styles.title}
                testID={`${testIdBase}-title`}
              >
                {presentation.label}
              </Text>
            </View>
          )}
        </WorkspaceTabPresentationResolver>
        <LeafHeaderActions
          isZoomed={isZoomed}
          canMoveToOwnTab
          testIdBase={testIdBase}
          onToggleZoom={onToggleZoom}
          onClose={handleClose}
          onMoveToOwnTab={handleMoveToOwnTab}
        />
      </View>
      <View style={styles.body}>
        <WorkspacePaneContent
          content={content}
          isWorkspaceFocused={composite.isWorkspaceFocused}
          isPaneFocused={composite.interactive && isFocused}
          onFocusPane={onFocusPane}
        />
      </View>
    </>
  );
}

function TabLocalDivider({
  divider,
  containerSize,
  onPreview,
  onCommit,
}: {
  divider: TabLocalDividerFrame;
  containerSize: ContainerSize;
  onPreview: (groupId: string, sizes: number[]) => void;
  onCommit: (groupId: string, sizes: number[]) => void;
}) {
  const axisSize =
    divider.direction === "horizontal"
      ? divider.groupRect.width * containerSize.width
      : divider.groupRect.height * containerSize.height;
  return (
    <View style={[styles.divider, dividerStyle(divider)]} pointerEvents="box-none">
      <ResizeHandle
        testID={`tab-local-divider-${divider.groupId}-${divider.index}`}
        direction={divider.direction}
        groupId={divider.groupId}
        index={divider.index}
        sizes={divider.sizes}
        containerSize={axisSize}
        onPreviewResizeSplit={onPreview}
        onResizeSplit={onCommit}
      />
    </View>
  );
}

/**
 * The body of a composite tab. Leaves are flat siblings keyed by tab id and positioned from the
 * tree's fractions, so splitting, closing a sibling or breaking a leaf out never re-parents a
 * terminal, chat or browser that stays on screen.
 */
export const TabLocalSplitView = memo(function TabLocalSplitView(props: TabLocalSplitViewProps) {
  const { workspaceKey, layout } = props;
  const hostTabId = layout.hostTabId;
  const [containerSize, setContainerSize] = useState<ContainerSize>({ width: 0, height: 0 });
  const [previewSizes, setPreviewSizes] = useState<Record<string, number[]>>({});
  const zoomedLeafId = useTabLocalSplitsStore(
    (state) => state.zoomedLeafByComposite[compositeKey(workspaceKey, hostTabId)] ?? null,
  );
  const setCompositeSize = useTabLocalSplitsStore((state) => state.setCompositeSize);
  const leafIds = useMemo(() => new Set(collectLeaves(layout.root).map(leafIdOf)), [layout.root]);
  const activeZoom = zoomedLeafId && leafIds.has(zoomedLeafId) ? zoomedLeafId : null;
  const frames = useMemo(
    () => computeTabLocalFrames(applyPreviewSizes(layout.root, previewSizes)),
    [layout.root, previewSizes],
  );
  const leavesById = useMemo(
    () => new Map(collectLeaves(layout.root).map((leaf) => [leafIdOf(leaf), leaf])),
    [layout.root],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      // A retained, hidden composite measures 0x0; that is not a size to split against.
      if (width <= 0 || height <= 0) return;
      setContainerSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
      setCompositeSize(workspaceKey, hostTabId, { width, height });
    },
    [hostTabId, setCompositeSize, workspaceKey],
  );
  const handlePreview = useCallback((groupId: string, sizes: number[]) => {
    setPreviewSizes((current) => ({ ...current, [groupId]: sizes }));
  }, []);
  const handleCommit = useCallback(
    (groupId: string, sizes: number[]) => {
      resizeTabLocalSplit({ workspaceKey, hostTabId, groupId, sizes });
      setPreviewSizes((current) => {
        const { [groupId]: _committed, ...rest } = current;
        return rest;
      });
    },
    [hostTabId, workspaceKey],
  );

  return (
    <View
      style={styles.composite}
      onLayout={handleLayout}
      testID={`tab-local-composite-${hostTabId}`}
    >
      {frames.leaves.map((frame) => {
        const leaf = leavesById.get(frame.leafId);
        if (!leaf) return null;
        const hidden = activeZoom !== null && activeZoom !== frame.leafId;
        return (
          <LeafSlot
            key={frame.leafId}
            leaf={leaf}
            rect={activeZoom === frame.leafId ? FULL_RECT : frame.rect}
            hidden={hidden}
            isFocused={layout.focusedLeafId === frame.leafId}
            isZoomed={activeZoom === frame.leafId}
            composite={props}
          />
        );
      })}
      {activeZoom
        ? null
        : frames.dividers.map((divider) => (
            <TabLocalDivider
              key={`${divider.groupId}:${divider.index}`}
              divider={divider}
              containerSize={containerSize}
              onPreview={handlePreview}
              onCommit={handleCommit}
            />
          ))}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  composite: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  slot: {
    position: "absolute",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
  },
  header: {
    height: LEAF_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    userSelect: "none",
  },
  titleFocused: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    userSelect: "none",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
  },
  zoomedHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginRight: theme.spacing[1],
  },
  zoomedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  body: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  divider: {
    position: "absolute",
    zIndex: 10,
  },
}));
