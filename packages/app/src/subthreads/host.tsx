import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  usePaneContext,
  usePaneFocus,
  type PaneContextValue,
} from "@/panels/pane-context";
import { ProviderSubagentPanel } from "@/panels/provider-subagent-panel";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { resolveRowLabel } from "@/subagents/track-presentation";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { ChecklistPanel } from "./checklist-panel";
import {
  SubthreadReplyTargetContext,
  SubthreadsHostContext,
  type SubthreadsHostValue,
} from "./context";
import { SubthreadsDrawer } from "./drawer";
import {
  CLOSED_SUBTHREADS_DRAWER,
  reduceSubthreadsDrawer,
  resolveComposerActivity,
  resolveSelectedSubthread,
  stepSubthreadSelection,
  type SidePanelMode,
  type SubthreadRow,
  type SubthreadSelection,
  type SubthreadsDrawerEvent,
  type SubthreadsFocus,
} from "./model";
import {
  CHECKLIST_URL_LABEL,
  parseChecklistUrl,
  parseSidePanelLabel,
  SIDE_PANEL_LABEL,
  sidePanelLabelPatch,
} from "./side-panel-labels";
import { clampSidePanelWidth, useSidePanelWidthStore } from "./side-panel-width-store";
import { useSubthreadRows } from "./use-subthread-rows";
import { useSubthreadTimelineSync } from "./use-subthread-timeline-sync";

/** Below this pane width the side panel covers the parent instead of sitting beside it. */
const SIDE_BY_SIDE_MIN_WIDTH = 820;

export interface RenderSubthreadAgentInput {
  serverId: string;
  workspaceId: string;
  agentId: string;
  isPaneFocused: boolean;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
}

export interface SubthreadsHostProps {
  serverId: string;
  workspaceId: string;
  /** The orchestrator: the agent whose pane hosts the side panel. */
  agentId: string;
  /** The parent's chat. Receives whether its composer may take input. */
  children: (parentActive: boolean) => ReactNode;
  /**
   * Renders a managed subthread's full chat. Injected by the agent panel so the drawer can
   * reuse the exact pane a tab would show without an import cycle.
   */
  renderAgent: (input: RenderSubthreadAgentInput) => ReactNode;
}

/**
 * Hosts a session's side panel — its subagents or its checklist — beside (or, when narrow,
 * over) its chat. The parent stays mounted throughout, exactly one of the two composers takes
 * input, and the panel's open/mode state lives in the session's labels so agents, the CLI and
 * other devices can drive it.
 */
export function SubthreadsHost({
  serverId,
  workspaceId,
  agentId,
  children,
  renderAgent,
}: SubthreadsHostProps): ReactElement {
  const instanceId = useId();
  const paneContext = usePaneContext();
  const paneFocus = usePaneFocus();
  const isCompact = useIsCompactFormFactor();
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  const [state, dispatch] = useReducer(reduceSubthreadsDrawer, CLOSED_SUBTHREADS_DRAWER);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { rows, summary } = useSubthreadRows({ serverId, parentAgentId: agentId });
  const selected = resolveSelectedSubthread(rows, state.selection);
  const coversParent = isCompact || (paneWidth !== null && paneWidth < SIDE_BY_SIDE_MIN_WIDTH);
  const { parentLabel, parentCwd, sidePanelLabel, checklistUrl } = useSessionSidePanelSource(
    serverId,
    agentId,
  );
  // COMPAT(companionStream): without a linked page the checklist is this session's Stream.
  const streamSupported = useHostFeature(serverId, "companionStream");
  const hasSubagents = rows.length > 0;
  const checklistAvailable = checklistUrl !== null || streamSupported;
  const mode = resolveAvailableMode(state.mode, hasSubagents, checklistAvailable);
  const effectiveState = useMemo(
    () => ({ ...state, mode, selection: selected ? state.selection : null }),
    [mode, selected, state],
  );
  const { parentActive, subthreadActive } = resolveComposerActivity({
    paneInteractive: paneFocus.isInteractive,
    state: effectiveState,
    drawerCoversParent: coversParent,
  });

  // The session's stored choice wins whenever it changes: an agent asked for a checklist, the
  // user closed the panel on another device, or the app reloaded. Absent label: no opinion.
  // Clearing the label (MCP `update_agent` with null) closes too; it is a choice, not silence.
  const labelPanel = parseSidePanelLabel(sidePanelLabel);
  const previousLabelPanelRef = useRef(labelPanel);
  useEffect(() => {
    const previous = previousLabelPanelRef.current;
    previousLabelPanelRef.current = labelPanel;
    if (labelPanel !== undefined) dispatch({ type: "apply-label", panel: labelPanel });
    else if (previous !== undefined) dispatch({ type: "apply-label", panel: null });
  }, [labelPanel]);

  // User gestures write the label back, so the choice persists for this session. Programmatic
  // changes arrive through the label and are never echoed.
  const persistPanel = useCallback(
    (panel: SidePanelMode | null) => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) return;
      void client.updateAgent(agentId, { labels: sidePanelLabelPatch(panel) }).catch(() => {});
    },
    [agentId, serverId],
  );
  const act = useCallback(
    (event: SubthreadsDrawerEvent) => {
      const current = stateRef.current;
      const next = reduceSubthreadsDrawer(current, event);
      dispatch(event);
      if (next.open !== current.open || (next.open && next.mode !== current.mode)) {
        persistPanel(next.open ? next.mode : null);
      }
    },
    [persistPanel],
  );

  // A child that was archived or detached leaves the list; never keep replying into it, and do
  // not take input away from wherever the user is typing.
  const hasStaleSelection = state.selection !== null && selected === null;
  useEffect(() => {
    if (hasStaleSelection) dispatch({ type: "clear-selection" });
  }, [hasStaleSelection]);

  useSubthreadTimelineSync({
    ownerKey: `subthreads:${serverId}:${agentId}:${instanceId}`,
    serverId,
    agentId: state.open && mode === "subagents" && selected?.kind === "paseo" ? selected.id : null,
  });

  const open = useCallback(
    (selection?: SubthreadSelection | null) => act({ type: "open", mode: "subagents", selection }),
    [act],
  );
  const openChecklist = useCallback(() => act({ type: "open", mode: "checklist" }), [act]);
  const toggle = useCallback(() => act({ type: "toggle" }), [act]);
  const close = useCallback(() => act({ type: "close" }), [act]);
  const changeMode = useCallback((next: SidePanelMode) => act({ type: "mode", mode: next }), [act]);
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const leaveThread = useCallback(() => dispatch({ type: "clear-selection" }), []);
  const select = useCallback(
    (selection: SubthreadSelection) => act({ type: "select", selection }),
    [act],
  );
  const claim = useCallback((focus: SubthreadsFocus) => dispatch({ type: "focus", focus }), []);
  const claimParent = useCallback(() => claim("parent"), [claim]);
  const claimDrawer = useCallback(() => claim("drawer"), [claim]);
  const step = useCallback(
    (delta: 1 | -1) => {
      const next = stepSubthreadSelection(rows, state.selection, delta);
      if (next) select(next);
    },
    [rows, select, state.selection],
  );

  const { openPreferredTarget } = paneContext;
  const openInTab = useCallback(
    (row: SubthreadRow) => {
      if (row.kind === "provider") {
        openPreferredTarget(
          { kind: "provider_subagent", parentAgentId: agentId, subagentId: row.id },
          "subagents",
        );
      } else if (row.workspaceId && row.workspaceId !== workspaceId) {
        navigateToAgent({ serverId, agentId: row.id });
      } else {
        openPreferredTarget({ kind: "agent", agentId: row.id }, "subagents");
      }
      act({ type: "close" });
    },
    [act, agentId, openPreferredTarget, serverId, workspaceId],
  );

  useKeyboardActionHandler({
    handlerId: `subthreads:${serverId}:${agentId}:${instanceId}`,
    actions: ["agent.subthreads.toggle"],
    enabled: paneFocus.isInteractive && (state.open || hasSubagents || checklistUrl !== null),
    priority: 100,
    handle: () => {
      toggle();
      return true;
    },
  });

  const hostValue = useMemo<SubthreadsHostValue>(
    () => ({
      isOpen: state.open,
      mode,
      summary,
      hasChecklistLink: checklistUrl !== null,
      open,
      openChecklist,
      close,
      toggle,
    }),
    [checklistUrl, close, mode, open, openChecklist, state.open, summary, toggle],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    setPaneWidth((current) => (current === width ? current : width));
  }, []);

  const drawerOwns = state.open && (coversParent || state.focus === "drawer");
  const parentRegionRef = useRef<View>(null);
  const drawerRegionRef = useRef<View>(null);
  useMoveDomFocus({ owner: drawerOwns ? "drawer" : "parent", parentRegionRef, drawerRegionRef });
  const parentCovered = state.open && coversParent;
  useInertRegion(parentRegionRef, parentCovered);

  // Everything in the parent's subtree that asks "is my pane focused" — find, shortcuts,
  // the composer — gets "no" while the side panel owns input.
  const parentFocusValue = useMemo(
    () =>
      createPaneFocusContextValue({
        isWorkspaceFocused: paneFocus.isWorkspaceFocused,
        isPaneFocused: paneFocus.isPaneFocused && (parentActive || !paneFocus.isInteractive),
        onFocusPane: paneFocus.focusPane,
      }),
    [
      paneFocus.focusPane,
      paneFocus.isInteractive,
      paneFocus.isPaneFocused,
      paneFocus.isWorkspaceFocused,
      parentActive,
    ],
  );

  return (
    <SubthreadsHostContext value={hostValue}>
      <View style={styles.root} onLayout={handleLayout} testID="subthreads-host">
        <FocusRegion
          regionRef={parentRegionRef}
          style={styles.parent}
          onClaim={claimParent}
          hidden={parentCovered}
        >
          <PaneFocusProvider value={parentFocusValue}>{children(parentActive)}</PaneFocusProvider>
        </FocusRegion>
        {state.open ? (
          <SidePanelFrame
            covers={coversParent}
            paneWidth={paneWidth}
            regionRef={drawerRegionRef}
            ownsFocus={paneFocus.isInteractive && drawerOwns}
            onClaim={claimDrawer}
          >
            {/* A subthread's own pane must not offer a nested panel. */}
            <SubthreadsHostContext value={null}>
              {mode === "checklist" ? (
                <ChecklistPanel
                  serverId={serverId}
                  agentId={agentId}
                  cwd={parentCwd}
                  url={checklistUrl}
                  showModeSwitch={hasSubagents}
                  onModeChange={changeMode}
                  onClose={close}
                  onFocusParent={claimParent}
                  onOpenWorkspaceFile={paneContext.openFileInWorkspace}
                />
              ) : (
                <SubthreadsDrawer
                  serverId={serverId}
                  parentLabel={parentLabel}
                  rows={rows}
                  summary={summary}
                  selected={selected}
                  showModeSwitch={checklistAvailable}
                  onModeChange={changeMode}
                  onSelect={select}
                  onBack={back}
                  onStep={step}
                  onClose={close}
                  onOpenInTab={openInTab}
                >
                  {selected ? (
                    <SubthreadPane
                      key={`${selected.kind}:${selected.id}`}
                      row={selected}
                      serverId={serverId}
                      parentAgentId={agentId}
                      parentWorkspaceId={workspaceId}
                      parentPane={paneContext}
                      isWorkspaceFocused={paneFocus.isWorkspaceFocused}
                      active={subthreadActive}
                      onFocusDrawer={claimDrawer}
                      onLeave={leaveThread}
                      renderAgent={renderAgent}
                    />
                  ) : null}
                </SubthreadsDrawer>
              )}
            </SubthreadsHostContext>
          </SidePanelFrame>
        ) : null}
      </View>
    </SubthreadsHostContext>
  );
}

/** A mode with nothing to show yields to the other one, so the panel is never empty by choice. */
function resolveAvailableMode(
  requested: SidePanelMode,
  hasSubagents: boolean,
  checklistAvailable: boolean,
): SidePanelMode {
  if (requested === "subagents" && !hasSubagents && checklistAvailable) return "checklist";
  if (requested === "checklist" && !checklistAvailable) return "subagents";
  return requested;
}

/** The parent session's name, directory, and its persisted side-panel labels. */
function useSessionSidePanelSource(serverId: string, agentId: string) {
  const { t } = useTranslation();
  const parentLabel = useSessionStore((s) => {
    const session = s.sessions[serverId];
    const parent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return resolveRowLabel(parent?.title) ?? t("subthreads.parentFallback");
  });
  const parentCwd = useSessionStore((s) => {
    const session = s.sessions[serverId];
    return (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))?.cwd ?? "";
  });
  const sidePanelLabel = useSessionStore((s) => {
    const session = s.sessions[serverId];
    const parent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return parent?.labels?.[SIDE_PANEL_LABEL];
  });
  const checklistUrl = useSessionStore((s) => {
    const session = s.sessions[serverId];
    const parent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return parseChecklistUrl(parent?.labels?.[CHECKLIST_URL_LABEL]);
  });
  return { parentLabel, parentCwd, sidePanelLabel, checklistUrl };
}

/**
 * The side panel's column: beside the parent with the app's sidebar resize handle (one
 * app-wide width, persisted), or covering the pane on narrow layouts.
 */
function SidePanelFrame({
  covers,
  paneWidth,
  regionRef,
  ownsFocus,
  onClaim,
  children,
}: {
  covers: boolean;
  paneWidth: number | null;
  regionRef: RefObject<View | null>;
  ownsFocus: boolean;
  onClaim: () => void;
  children: ReactNode;
}): ReactElement {
  const storedWidth = useSidePanelWidthStore((s) => s.width);
  const setStoredWidth = useSidePanelWidthStore((s) => s.setWidth);
  const containerWidth = paneWidth ?? storedWidth * 2;
  const visibleWidth = clampSidePanelWidth(storedWidth, containerWidth);
  const width = useSharedValue(visibleWidth);
  const startWidth = useSharedValue(visibleWidth);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    width.value = visibleWidth;
  }, [visibleWidth, width]);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onBegin(() => runOnJS(setResizing)(true))
        .onStart(() => {
          startWidth.value = width.value;
        })
        .onUpdate((event) => {
          width.value = clampSidePanelWidth(startWidth.value - event.translationX, containerWidth);
        })
        .onEnd(() => runOnJS(setStoredWidth)(width.value))
        .onFinalize(() => runOnJS(setResizing)(false)),
    [containerWidth, setStoredWidth, startWidth, width],
  );
  const widthStyle = useAnimatedStyle(() => ({ width: width.value }));
  // One tree for both layouts: crossing the breakpoint restyles the frame instead of remounting
  // the checklist page or the open subagent behind it.
  const frameStyle = covers
    ? styles.panelOverlay
    : [styles.panelColumn, ownsFocus ? styles.panelColumnFocused : null, widthStyle];
  return (
    <Animated.View style={frameStyle}>
      {covers ? null : (
        <SidebarResizeHandle
          edge="left"
          gesture={gesture}
          pressed={resizing}
          testID="session-side-panel-resize-handle"
        />
      )}
      <FocusRegion regionRef={regionRef} style={styles.panelFill} onClaim={onClaim}>
        {children}
      </FocusRegion>
    </Animated.View>
  );
}

function SubthreadPane({
  row,
  serverId,
  parentAgentId,
  parentWorkspaceId,
  parentPane,
  isWorkspaceFocused,
  active,
  onFocusDrawer,
  onLeave,
  renderAgent,
}: {
  row: SubthreadRow;
  serverId: string;
  parentAgentId: string;
  parentWorkspaceId: string;
  parentPane: PaneContextValue;
  isWorkspaceFocused: boolean;
  active: boolean;
  onFocusDrawer: () => void;
  onLeave: () => void;
  renderAgent: (input: RenderSubthreadAgentInput) => ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const childWorkspaceId = row.workspaceId ?? parentWorkspaceId;
  const sameWorkspace = childWorkspaceId === parentWorkspaceId;
  const target = useMemo<WorkspaceTabTarget>(
    () =>
      row.kind === "provider"
        ? { kind: "provider_subagent", parentAgentId, subagentId: row.id }
        : { kind: "agent", agentId: row.id },
    [parentAgentId, row.id, row.kind],
  );

  // Tab and file actions from inside the subthread land in the parent's workspace when they
  // share it; otherwise the child is opened in its own workspace. Closing or retargeting the
  // "current tab" only ever affects the drawer, never the orchestrator's tab.
  const scopedPane = useMemo<PaneContextValue>(() => {
    const openElsewhere = () => navigateToAgent({ serverId, agentId: row.id });
    return {
      serverId,
      workspaceId: childWorkspaceId,
      host: parentPane.host,
      tabId: `subthread:${parentPane.tabId}:${row.kind}:${row.id}`,
      target,
      state: undefined,
      openTab: sameWorkspace ? parentPane.openTab : openElsewhere,
      openPreferredTarget: sameWorkspace ? parentPane.openPreferredTarget : openElsewhere,
      openTargetToSide: sameWorkspace ? parentPane.openTargetToSide : undefined,
      // `/clear` and `/exit` typed to the subagent act on the subagent; the drawer simply leaves
      // its thread. Nothing opens or closes in the parent's workspace.
      closeCurrentTab: onLeave,
      retargetCurrentTab: onLeave,
      setCurrentTabState: () => {},
      openFileInWorkspace: sameWorkspace ? parentPane.openFileInWorkspace : openElsewhere,
      openImportSheet: parentPane.openImportSheet,
    };
  }, [childWorkspaceId, onLeave, parentPane, row.id, row.kind, sameWorkspace, serverId, target]);

  const focusValue = useMemo(
    () =>
      createPaneFocusContextValue({
        isWorkspaceFocused,
        isPaneFocused: active,
        onFocusPane: onFocusDrawer,
      }),
    [active, isWorkspaceFocused, onFocusDrawer],
  );
  const replyTarget = useMemo(
    () =>
      row.canReply ? { agentId: row.id, label: row.label ?? t("common.states.loading") } : null,
    [row.canReply, row.id, row.label, t],
  );

  return (
    <PaneProvider value={scopedPane}>
      <PaneFocusProvider value={focusValue}>
        <SubthreadReplyTargetContext value={replyTarget}>
          {row.kind === "provider" ? (
            <ProviderSubagentPanel />
          ) : (
            renderAgent({
              serverId,
              workspaceId: childWorkspaceId,
              agentId: row.id,
              isPaneFocused: active,
              onOpenWorkspaceFile: scopedPane.openFileInWorkspace,
            })
          )}
        </SubthreadReplyTargetContext>
      </PaneFocusProvider>
    </PaneProvider>
  );
}

/**
 * Observes, without capturing, presses and keyboard focus that enter a region, so the side the
 * user is working in owns input. Touches still reach their targets.
 */
function FocusRegion({
  regionRef,
  style,
  onClaim,
  hidden = false,
  children,
}: {
  regionRef: RefObject<View | null>;
  style: StyleProp<ViewStyle>;
  onClaim: () => void;
  /** Covered by the side panel: out of touch, the accessibility tree, and the tab order. */
  hidden?: boolean;
  children: ReactNode;
}): ReactElement {
  const onClaimRef = useRef(onClaim);
  onClaimRef.current = onClaim;
  useEffect(() => {
    if (!isWeb) return;
    const node = regionRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const listener = () => onClaimRef.current();
    node.addEventListener("focusin", listener);
    return () => node.removeEventListener("focusin", listener);
  }, [regionRef]);
  const handleCapture = useCallback(() => {
    onClaimRef.current();
    return false;
  }, []);
  return (
    <View
      ref={regionRef}
      collapsable={false}
      style={style}
      pointerEvents={hidden ? "none" : "auto"}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      onStartShouldSetResponderCapture={handleCapture}
    >
      {children}
    </View>
  );
}

/**
 * Web: a covered region is `inert`, so Tab cannot reach the parent's textarea under the panel
 * and Enter there cannot send to an agent the user is not looking at.
 */
function useInertRegion(regionRef: RefObject<View | null>, inert: boolean): void {
  useEffect(() => {
    if (!isWeb) return;
    const node = regionRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.toggleAttribute !== "function") return;
    node.toggleAttribute("inert", inert);
    return () => {
      node.toggleAttribute("inert", false);
    };
  }, [inert, regionRef]);
}

/**
 * Web: when ownership changes hands, move the caret with it. Otherwise the parent's textarea
 * keeps DOM focus while the subthread's composer is the active one (or focus drops to the page
 * when the drawer closes under it), and typed text lands somewhere the target does not name.
 * A press inside the new owner already put focus there and is left alone.
 */
function useMoveDomFocus(input: {
  owner: SubthreadsFocus;
  parentRegionRef: RefObject<View | null>;
  drawerRegionRef: RefObject<View | null>;
}): void {
  const { owner, parentRegionRef, drawerRegionRef } = input;
  const previousOwnerRef = useRef(owner);
  useEffect(() => {
    const previous = previousOwnerRef.current;
    previousOwnerRef.current = owner;
    if (previous === owner || !isWeb || typeof document === "undefined") return;
    const region = (owner === "drawer" ? drawerRegionRef : parentRegionRef)
      .current as unknown as HTMLElement | null;
    const activeElement = document.activeElement;
    if (!region || (activeElement && region.contains(activeElement))) return;
    const destination =
      region.querySelector<HTMLElement>("textarea") ??
      region.querySelector<HTMLElement>('[data-testid^="subthreads-row-"]');
    destination?.focus();
  }, [drawerRegionRef, owner, parentRegionRef]);
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
  },
  parent: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  panelColumn: {
    position: "relative",
    flexShrink: 0,
    minHeight: 0,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  // Which side of the pane receives what is typed: a heavier edge, not a colour (accent is the
  // surface's one CTA).
  panelColumnFocused: {
    borderLeftWidth: theme.borderWidth[2],
    borderLeftColor: theme.colors.foregroundMuted,
  },
  panelFill: {
    flex: 1,
    minHeight: 0,
  },
  panelOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
    backgroundColor: theme.colors.surface0,
  },
}));
