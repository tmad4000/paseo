import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Ellipsis,
  SquareArrowOutUpRight,
  X,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { getProviderIcon } from "@/components/provider-icons";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PaneContentToolbar,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ComposerTrackMark } from "@/composer/tracks";
import { isWeb } from "@/constants/platform";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { SidePanelModeSwitch, SUBTHREADS_TOGGLE_SHORTCUT_ID } from "./mode-switch";
import {
  buildRegistryFocusItems,
  moveRegistryFocus,
  registryCardFocusKey,
  registryGroupFocusKey,
  resolveGroupCollapsed,
  resolveRegistryFocusAfterRemoval,
  type RegistryFocusItem,
  type SidePanelMode,
  type SubthreadGroup,
  type SubthreadGroupKind,
  type SubthreadRow,
  type SubthreadSelection,
  type SubthreadSummary,
} from "./model";
import {
  groupAccessibilityLabel,
  groupSummaryParts,
  resolveModeLabel,
  resolveModelLabel,
  subthreadGroupName,
  subthreadStateLabel,
} from "./registry-labels";
import { registryChatKey, useSubagentRegistryStore } from "./registry-store";

const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedOpenInTab = withUnistyles(SquareArrowOutUpRight);
const ThemedX = withUnistyles(X);

const TOOLBAR_ICON_SIZE = 16;
const CARD_ICON_SIZE = 14;
/** The expanded report shows this many lines, then "Show more" goes to the peek. */
const REPORT_LINES = 6;
/** Rough line budget for "is there more than six lines of report": newlines or long text. */
const REPORT_CHARS_PER_LINE = 60;

export interface SubthreadsDrawerProps {
  serverId: string;
  /** The orchestrator; its groups' folds are remembered per chat. */
  parentAgentId: string;
  parentLabel: string;
  rows: readonly SubthreadRow[];
  /** `rows` split into spawned agents and provider subagents, never interleaved. */
  groups: readonly SubthreadGroup[];
  summary: SubthreadSummary;
  selected: SubthreadRow | null;
  onSelect: (selection: SubthreadSelection) => void;
  onBack: () => void;
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  onOpenInTab: (row: SubthreadRow) => void;
  onArchive: (agentId: string) => void;
  /** Present when the host supports detaching a subagent from its parent. */
  onDetach?: (agentId: string) => void;
  /** Escape in the list: back to the parent's composer (or close, where the panel covers it). */
  onEscapeList: () => void;
  /** The session also has a checklist, so the list header switches between the two. */
  showModeSwitch: boolean;
  onModeChange: (mode: SidePanelMode) => void;
  /** Renders the selected subthread's own chat (managed) or read-only timeline (provider). */
  children: ReactNode;
}

/**
 * The subagents registry: the session side panel's Subagents mode. Its list holds two headed,
 * collapsible groups — spawned agents, then provider subagents — of cards that peek on press
 * and expand in place for detail. Its thread view is the peek: the selected agent's own pane.
 */
export function SubthreadsDrawer(props: SubthreadsDrawerProps): ReactElement {
  const { selected, groups, serverId, parentAgentId } = props;
  const chatKey = registryChatKey(serverId, parentAgentId);
  const storedGroups = useSubagentRegistryStore((state) => state.groups[chatKey]);
  const setGroupCollapsed = useSubagentRegistryStore((state) => state.setGroupCollapsed);
  const hasSpawned = groups.some((group) => group.kind === "paseo");
  const isCollapsed = useCallback(
    (kind: SubthreadGroupKind) =>
      resolveGroupCollapsed({ kind, stored: storedGroups?.[kind], hasSpawned }),
    [hasSpawned, storedGroups],
  );
  const toggleGroup = useCallback(
    (kind: SubthreadGroupKind) => setGroupCollapsed(chatKey, kind, !isCollapsed(kind)),
    [chatKey, isCollapsed, setGroupCollapsed],
  );
  const items = useMemo(() => buildRegistryFocusItems(groups, isCollapsed), [groups, isCollapsed]);
  const returnFocusKey = useReturnFocusKey(selected, items);
  return (
    <View style={styles.drawer} testID="subthreads-drawer">
      {selected ? <ThreadHeader {...props} selected={selected} /> : <ListHeader {...props} />}
      {selected ? (
        <View style={styles.thread} testID={`subthreads-thread-${selected.id}`}>
          {props.children}
        </View>
      ) : (
        <RegistryList
          {...props}
          items={items}
          isCollapsed={isCollapsed}
          onToggleGroup={toggleGroup}
          initialFocusKey={returnFocusKey}
        />
      )}
    </View>
  );
}

/**
 * Where focus lands when the peek closes: back on the card it came from, or, when that agent left
 * the list while it was open (archived, detached), on the card that took its place.
 */
function useReturnFocusKey(
  selected: SubthreadRow | null,
  items: readonly RegistryFocusItem[],
): string | null {
  const snapshotRef = useRef<{ key: string; items: readonly RegistryFocusItem[] } | null>(null);
  const [returnKey, setReturnKey] = useState<string | null>(null);
  const selectedKey = selected ? registryCardFocusKey(selected) : null;
  if (selectedKey && items.some((item) => item.key === selectedKey)) {
    snapshotRef.current = { key: selectedKey, items };
  }
  const wasOpen = useRef(selectedKey !== null);
  useEffect(() => {
    const open = selectedKey !== null;
    if (wasOpen.current && !open) {
      const snapshot = snapshotRef.current;
      setReturnKey(
        snapshot ? resolveRegistryFocusAfterRemoval(snapshot.items, items, snapshot.key) : null,
      );
      snapshotRef.current = null;
    } else if (open) {
      setReturnKey(null);
    }
    wasOpen.current = open;
  }, [items, selectedKey]);
  return returnKey;
}

function rowLabel(t: TFunction, row: SubthreadRow): string {
  return row.label ?? t("subthreads.untitled");
}

export function buildSubthreadsSummaryLabel(t: TFunction, summary: SubthreadSummary): string {
  const parts: string[] = [];
  if (summary.needsInput === 1) parts.push(t("subthreads.summary.needsInputOne"));
  if (summary.needsInput > 1) {
    parts.push(t("subthreads.summary.needsInputMany", { count: summary.needsInput }));
  }
  if (summary.failed > 0) parts.push(t("subthreads.summary.failed", { count: summary.failed }));
  if (summary.unread > 0) parts.push(t("subthreads.summary.unread", { count: summary.unread }));
  if (summary.running > 0) parts.push(t("subthreads.summary.working", { count: summary.running }));
  if (parts.length > 0) return parts.join(" · ");
  return summary.total === 1
    ? t("subthreads.summary.totalOne")
    : t("subthreads.summary.totalMany", { count: summary.total });
}

function ListHeader({
  summary,
  onClose,
  showModeSwitch,
  onModeChange,
}: SubthreadsDrawerProps): ReactElement {
  const { t } = useTranslation();
  const shortcut = useShortcutKeys(SUBTHREADS_TOGGLE_SHORTCUT_ID);
  return (
    <PaneContentToolbar style={styles.toolbar} testID="subthreads-list-header">
      {showModeSwitch ? (
        <View style={styles.modeSwitch}>
          <SidePanelModeSwitch mode="subagents" onModeChange={onModeChange} />
        </View>
      ) : null}
      <View style={styles.titleBlock}>
        {showModeSwitch ? null : (
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {t("subthreads.title")}
          </Text>
        )}
        {/* The one live region: card bodies and ages change quietly. */}
        <Text
          style={styles.meta}
          numberOfLines={1}
          accessibilityLiveRegion="polite"
          testID="subthreads-summary"
        >
          {buildSubthreadsSummaryLabel(t, summary)}
        </Text>
      </View>
      <ToolbarControls>
        <ToolbarButton
          label={t("subthreads.close")}
          shortcut={shortcut}
          onPress={onClose}
          testID="subthreads-close"
        >
          <ThemedX size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
        </ToolbarButton>
      </ToolbarControls>
    </PaneContentToolbar>
  );
}

function ThreadHeader({
  serverId,
  parentLabel,
  rows,
  selected,
  onBack,
  onStep,
  onClose,
  onOpenInTab,
}: SubthreadsDrawerProps & { selected: SubthreadRow }): ReactElement {
  const { t } = useTranslation();
  const shortcut = useShortcutKeys(SUBTHREADS_TOGGLE_SHORTCUT_ID);
  const presentation = useRowPresentation(selected, serverId, t);
  const handleOpenInTab = useCallback(() => onOpenInTab(selected), [onOpenInTab, selected]);
  const handlePrevious = useCallback(() => onStep(-1), [onStep]);
  const handleNext = useCallback(() => onStep(1), [onStep]);
  const headerRef = useRef<View>(null);
  // Escape on the peek's own controls goes back to the list. Inside the agent's pane Escape
  // already means "interrupt", so it is left alone there.
  useWebKeyDown(headerRef, (event) => {
    if (event.key !== "Escape" || hasModifier(event)) return false;
    onBack();
    return true;
  });
  const label = rowLabel(t, selected);
  return (
    <View ref={headerRef}>
      <PaneContentToolbar style={styles.threadToolbar} testID="subthreads-thread-header">
        <ToolbarButton label={t("subthreads.back")} onPress={onBack} testID="subthreads-back">
          <ThemedChevronLeft size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
        </ToolbarButton>
        <View style={styles.targetBlock}>
          <WorkspaceTabIcon presentation={presentation} backdrop="surface0" />
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1} testID="subthreads-target-title">
              {label}
            </Text>
            <Text style={styles.meta} numberOfLines={1} testID="subthreads-target-path">
              {t("subthreads.targetPath", {
                parent: parentLabel,
                state: subthreadStateLabel(t, selected),
              })}
            </Text>
          </View>
        </View>
        <ToolbarControls>
          {rows.length > 1 ? (
            <>
              <ToolbarButton
                label={t("subthreads.previous")}
                onPress={handlePrevious}
                testID="subthreads-previous"
              >
                <ThemedChevronUp size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
              </ToolbarButton>
              <ToolbarButton
                label={t("subthreads.next")}
                onPress={handleNext}
                testID="subthreads-next"
              >
                <ThemedChevronDown size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
              </ToolbarButton>
            </>
          ) : null}
          <ToolbarButton
            label={t("subthreads.openInTab")}
            onPress={handleOpenInTab}
            testID="subthreads-open-in-tab"
          >
            <ThemedOpenInTab size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
          </ToolbarButton>
          <ToolbarButton
            label={t("subthreads.close")}
            shortcut={shortcut}
            onPress={onClose}
            testID="subthreads-close"
          >
            <ThemedX size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
          </ToolbarButton>
        </ToolbarControls>
      </PaneContentToolbar>
      {selected.canReply ? null : (
        <View style={styles.readOnlyStrip} testID="subthreads-read-only">
          <Text style={styles.meta}>{t("subthreads.readOnly", { parent: parentLabel })}</Text>
        </View>
      )}
    </View>
  );
}

function useRowPresentation(
  row: SubthreadRow,
  serverId: string,
  t: TFunction,
): WorkspaceTabPresentation {
  return useMemo(() => {
    const label = rowLabel(t, row);
    return {
      key: `subthread_${row.kind}_${row.id}`,
      kind: "agent",
      label,
      subtitle: row.subtitle ?? "",
      tooltip: label,
      modified: false,
      titleState: "ready",
      icon: getProviderIcon(row.provider, serverId),
      statusBucket: row.bucket,
      running: row.bucket === "running",
    };
  }, [row, serverId, t]);
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}

/**
 * Web: a keydown listener on a region. A handled key stops there, so the app's global shortcuts
 * (Escape interrupts an agent) never see it.
 */
function useWebKeyDown(
  ref: RefObject<View | null>,
  handler: (event: KeyboardEvent) => boolean,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!isWeb) return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const listener = (event: KeyboardEvent) => {
      if (!handlerRef.current(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    node.addEventListener("keydown", listener);
    return () => node.removeEventListener("keydown", listener);
  }, [ref]);
}

function focusRegistryItem(container: View | null, key: string): void {
  if (!isWeb) return;
  const node = container as unknown as HTMLElement | null;
  if (!node || typeof node.querySelector !== "function") return;
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key;
  node.querySelector<HTMLElement>(`[data-registry-key="${escaped}"]`)?.focus();
}

interface RegistryListProps extends SubthreadsDrawerProps {
  items: readonly RegistryFocusItem[];
  isCollapsed: (kind: SubthreadGroupKind) => boolean;
  onToggleGroup: (kind: SubthreadGroupKind) => void;
  initialFocusKey: string | null;
}

/**
 * One tab stop with roving focus (web and desktop): Up and Down walk headings and cards across
 * groups, Right and Left expand or fold, Enter peeks a card or toggles a heading, Mod+Enter opens
 * a card in a tab, Escape returns to the parent. Buttons inside an expanded card are reached with
 * Tab. Native has no roving focus; every control is a plain, always-visible button there.
 */
function RegistryList(props: RegistryListProps): ReactElement {
  const {
    serverId,
    groups,
    items,
    isCollapsed,
    onToggleGroup,
    onSelect,
    onOpenInTab,
    onEscapeList,
    initialFocusKey,
  } = props;
  const { t } = useTranslation();
  const containerRef = useRef<View>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const itemsRef = useRef(items);
  const previousItemsRef = useRef(items);
  itemsRef.current = items;
  const { entries: providerEntries } = useProvidersSnapshot(serverId);

  // Roving focus defaults to the first card, so the shortcut lands on content, not a heading.
  const fallbackKey = items.find((item) => item.type === "card")?.key ?? items[0]?.key ?? null;
  const rovingKey =
    currentKey && items.some((item) => item.key === currentKey) ? currentKey : fallbackKey;

  // Focus is never lost: a card that leaves while focused (archived, detached, its group folded)
  // hands focus to the item that took its place.
  useEffect(() => {
    const previous = previousItemsRef.current;
    previousItemsRef.current = items;
    if (!isWeb || !currentKey || items.some((item) => item.key === currentKey)) return;
    const node = containerRef.current as unknown as HTMLElement | null;
    const hadFocus = node?.contains?.(document.activeElement) ?? false;
    const next = resolveRegistryFocusAfterRemoval(previous, items, currentKey);
    setCurrentKey(next);
    if (hadFocus || document.activeElement === document.body) {
      if (next) requestAnimationFrame(() => focusRegistryItem(containerRef.current, next));
    }
  }, [currentKey, items]);

  useEffect(() => {
    if (!initialFocusKey) return;
    setCurrentKey(initialFocusKey);
    requestAnimationFrame(() => focusRegistryItem(containerRef.current, initialFocusKey));
  }, [initialFocusKey]);

  const toggleCard = useCallback((key: string, open?: boolean) => {
    setExpanded((current) => {
      const isOpen = current.has(key);
      const want = open ?? !isOpen;
      if (want === isOpen) return current;
      const next = new Set(current);
      if (want) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const moveTo = useCallback((key: string | null) => {
    if (!key) return;
    setCurrentKey(key);
    focusRegistryItem(containerRef.current, key);
  }, []);

  useWebKeyDown(containerRef, (event) => {
    const target = event.target as HTMLElement | null;
    const key = target?.getAttribute?.("data-registry-key");
    if (event.key === "Escape" && !hasModifier(event)) {
      onEscapeList();
      return true;
    }
    // Keys inside an expanded card's buttons keep their own meaning.
    if (!key) return false;
    const item = itemsRef.current.find((candidate) => candidate.key === key);
    if (!item) return false;
    switch (event.key) {
      case "ArrowDown":
        moveTo(moveRegistryFocus(itemsRef.current, key, 1));
        return true;
      case "ArrowUp":
        moveTo(moveRegistryFocus(itemsRef.current, key, -1));
        return true;
      case "ArrowRight":
      case "ArrowLeft": {
        const open = event.key === "ArrowRight";
        if (item.type === "group") {
          if (isCollapsed(item.kind) === open) onToggleGroup(item.kind);
        } else {
          toggleCard(item.key, open);
        }
        return true;
      }
      case "Enter":
        if (item.type === "card" && (event.metaKey || event.ctrlKey)) {
          onOpenInTab(item.row);
          return true;
        }
        // Plain Enter is the focused button's own press: peek a card, toggle a heading.
        return false;
      default:
        return false;
    }
  });

  if (groups.length === 0) {
    return (
      <View style={styles.empty} testID="subthreads-empty">
        <Text style={styles.meta}>{t("subthreads.empty")}</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      <View ref={containerRef} style={styles.groups} testID="subthreads-registry">
        {groups.map((group) => {
          const collapsed = isCollapsed(group.kind);
          return (
            <View key={group.kind} style={styles.group} testID={`subthreads-group-${group.kind}`}>
              <GroupHeading
                group={group}
                collapsed={collapsed}
                rovingKey={rovingKey}
                onToggle={onToggleGroup}
                onFocusItem={setCurrentKey}
              />
              {collapsed ? null : (
                <View style={styles.cardList}>
                  {group.rows.map((row, index) => (
                    <RegistryCard
                      key={`${row.kind}:${row.id}`}
                      row={row}
                      first={index === 0}
                      serverId={serverId}
                      providerEntries={providerEntries}
                      expanded={expanded.has(registryCardFocusKey(row))}
                      rovingKey={rovingKey}
                      onToggle={toggleCard}
                      onFocusItem={setCurrentKey}
                      onSelect={onSelect}
                      onOpenInTab={onOpenInTab}
                      onArchive={props.onArchive}
                      onDetach={props.onDetach}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** Web roving focus: only the current item is in the tab order. */
function rovingProps(key: string, rovingKey: string | null) {
  return isWeb
    ? {
        dataSet: { registryKey: key, registryCurrent: key === rovingKey ? "true" : "false" },
        tabIndex: (key === rovingKey ? 0 : -1) as 0 | -1,
      }
    : null;
}

function GroupHeading({
  group,
  collapsed,
  rovingKey,
  onToggle,
  onFocusItem,
}: {
  group: SubthreadGroup;
  collapsed: boolean;
  rovingKey: string | null;
  onToggle: (kind: SubthreadGroupKind) => void;
  onFocusItem: (key: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const key = registryGroupFocusKey(group.kind);
  const handlePress = useCallback(() => onToggle(group.kind), [group.kind, onToggle]);
  const handleFocus = useCallback(() => onFocusItem(key), [key, onFocusItem]);
  const parts = collapsed ? groupSummaryParts(t, group.summary) : [];
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const ChevronIcon = collapsed ? ThemedChevronRight : ThemedChevronDown;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={groupAccessibilityLabel(t, group.kind, group.summary)}
      accessibilityState={accessibilityState}
      aria-expanded={!collapsed}
      onPress={handlePress}
      onFocus={handleFocus}
      style={headingStyle}
      testID={`subthreads-group-toggle-${group.kind}`}
      {...rovingProps(key, rovingKey)}
    >
      <ChevronIcon size={CARD_ICON_SIZE} uniProps={mutedIconColorMapping} />
      <Text style={styles.groupHeading} numberOfLines={1}>
        {t("subthreads.groups.heading", {
          name: subthreadGroupName(t, group.kind),
          count: group.summary.total,
        })}
      </Text>
      {parts.length > 0 ? (
        <Text
          style={styles.groupSummary}
          numberOfLines={1}
          testID={`subthreads-group-summary-${group.kind}`}
        >
          {parts.join(" · ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

function headingStyle({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) {
  return [styles.heading, pressed || hovered ? styles.headingActive : null];
}

function formatTimestamp(date: Date | null, language: string): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

interface RegistryCardProps {
  row: SubthreadRow;
  first: boolean;
  serverId: string;
  providerEntries: readonly ProviderSnapshotEntry[] | undefined;
  expanded: boolean;
  rovingKey: string | null;
  onToggle: (key: string) => void;
  onFocusItem: (key: string) => void;
  onSelect: (selection: SubthreadSelection) => void;
  onOpenInTab: (row: SubthreadRow) => void;
  onArchive: (agentId: string) => void;
  onDetach?: (agentId: string) => void;
}

function RegistryCard({
  row,
  first,
  serverId,
  providerEntries,
  expanded,
  rovingKey,
  onToggle,
  onFocusItem,
  onSelect,
  onOpenInTab,
  onArchive,
  onDetach,
}: RegistryCardProps): ReactElement {
  const { t, i18n } = useTranslation();
  const key = registryCardFocusKey(row);
  const label = rowLabel(t, row);
  const state = subthreadStateLabel(t, row);
  const model = resolveModelLabel(providerEntries, row.provider, row.model);
  const secondary = row.kind === "provider" ? row.subtitle : model;
  const timestamp = formatTimestamp(row.lastActivityAt, i18n.language);
  const handlePeek = useCallback(() => onSelect({ kind: row.kind, id: row.id }), [onSelect, row]);
  const handleToggle = useCallback(() => onToggle(key), [key, onToggle]);
  const handleFocus = useCallback(() => onFocusItem(key), [key, onFocusItem]);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const access = row.canReply ? t("subthreads.canReply") : t("subthreads.readOnlyShort");
  const accessibilityLabel = [
    label,
    state,
    secondary,
    timestamp ? t("subthreads.card.lastActive", { time: timestamp }) : null,
    access,
    row.activity?.text ?? null,
  ]
    .filter(Boolean)
    .join(", ");
  const toggleLabel = expanded
    ? t("subthreads.card.hideDetails", { label })
    : t("subthreads.card.showDetails", { label });
  return (
    <View
      style={[styles.card, first ? null : styles.cardDivider]}
      testID={`subthreads-card-${row.id}`}
    >
      <View style={styles.cardTop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={t("subthreads.openHint")}
          onPress={handlePeek}
          onFocus={handleFocus}
          style={cardMainStyle}
          testID={`subthreads-row-${row.id}`}
          {...rovingProps(key, rovingKey)}
        >
          <View style={styles.cardLine}>
            <View style={styles.markSlot}>
              <ComposerTrackMark bucket={row.bucket} />
            </View>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {label}
            </Text>
          </View>
          <View style={styles.cardLine}>
            <View style={styles.markSlot} />
            <CardState row={row} state={state} />
            {secondary ? (
              <>
                <Text style={styles.meta}>·</Text>
                {row.kind === "paseo" ? (
                  <View style={styles.providerIcon}>
                    <ProviderGlyph provider={row.provider} serverId={serverId} />
                  </View>
                ) : null}
                <Text
                  style={styles.cardSecondary}
                  numberOfLines={1}
                  testID={`subthreads-card-model-${row.id}`}
                >
                  {secondary}
                </Text>
              </>
            ) : null}
          </View>
          {row.activity ? (
            <View style={styles.cardLine}>
              <View style={styles.markSlot} />
              <Text
                style={row.activity.kind === "blocker" ? styles.activityBlocker : styles.meta}
                numberOfLines={1}
                testID={`subthreads-row-activity-${row.id}`}
              >
                {row.activity.text}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <View style={styles.cardTrailing}>
          <CardAge
            date={row.lastActivityAt}
            timestamp={timestamp}
            testID={`subthreads-card-age-${row.id}`}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={toggleLabel}
            accessibilityState={accessibilityState}
            aria-expanded={expanded}
            onPress={handleToggle}
            hitSlop={8}
            style={chevronStyle}
            testID={`subthreads-card-toggle-${row.id}`}
            // Right and Left on the card reach this; it is not a second tab stop per card.
            {...(isWeb ? { tabIndex: -1 as const } : null)}
          >
            {expanded ? (
              <ThemedChevronUp size={CARD_ICON_SIZE} uniProps={mutedIconColorMapping} />
            ) : (
              <ThemedChevronDown size={CARD_ICON_SIZE} uniProps={mutedIconColorMapping} />
            )}
          </Pressable>
        </View>
      </View>
      {expanded ? (
        <CardDetail
          row={row}
          label={label}
          modeLabel={resolveModeLabel(providerEntries, row.provider, row.detail.modeId)}
          onPeek={handlePeek}
          onOpenInTab={onOpenInTab}
          onArchive={onArchive}
          onDetach={onDetach}
        />
      ) : null}
    </View>
  );
}

/** The provider's own glyph, small, beside the model name. */
function ProviderGlyph({ provider, serverId }: { provider: string; serverId: string }) {
  const Icon = useMemo(() => getProviderIcon(provider, serverId), [provider, serverId]);
  return <Icon size={12} color={styles.meta.color} />;
}

function CardState({ row, state }: { row: SubthreadRow; state: string }): ReactElement {
  if (row.needsInput) return <StatusBadge label={state} variant="warning" />;
  if (row.bucket === "failed") return <StatusBadge label={state} variant="error" />;
  return <Text style={styles.cardState}>{state}</Text>;
}

/** A compact, ticking age, with the full local time on hover. */
function CardAge({
  date,
  timestamp,
  testID,
}: {
  date: Date | null;
  timestamp: string | null;
  testID: string;
}): ReactElement | null {
  const age = useCompactTimeAgo(date);
  if (!age) return null;
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.age} testID={testID}>
            {age}
          </Text>
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" offset={6}>
        <Text style={styles.tooltipText}>{timestamp}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function reportNeedsMore(text: string): boolean {
  const lines = text.split("\n");
  const wrapped = lines.reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / REPORT_CHARS_PER_LINE)),
    0,
  );
  return wrapped > REPORT_LINES;
}

function CardDetail({
  row,
  label,
  modeLabel,
  onPeek,
  onOpenInTab,
  onArchive,
  onDetach,
}: {
  row: SubthreadRow;
  label: string;
  modeLabel: string | null;
  onPeek: () => void;
  onOpenInTab: (row: SubthreadRow) => void;
  onArchive: (agentId: string) => void;
  onDetach?: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { detail } = row;
  const handleOpenInTab = useCallback(() => onOpenInTab(row), [onOpenInTab, row]);
  const meta = [modeLabel, detail.location].filter(Boolean).join(" · ");
  const report = detail.report;
  return (
    <View style={styles.detail} testID={`subthreads-card-detail-${row.id}`}>
      {row.kind === "provider" ? (
        <>
          {detail.description ? (
            <Text style={styles.detailText} testID={`subthreads-card-description-${row.id}`}>
              {detail.description}
            </Text>
          ) : null}
          {detail.subagentType ? (
            <Text style={styles.meta}>
              {t("subthreads.card.type", { type: detail.subagentType })}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          {report ? (
            <View>
              <Text
                style={report.kind === "blocker" ? styles.detailText : styles.detailReport}
                numberOfLines={REPORT_LINES}
                testID={`subthreads-card-report-${row.id}`}
              >
                {report.text}
              </Text>
              {reportNeedsMore(report.text) ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={onPeek}
                  hitSlop={6}
                  testID={`subthreads-card-show-more-${row.id}`}
                >
                  <Text style={styles.linkText}>{t("subthreads.card.showMore")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {detail.pendingPermission ? (
            <View style={styles.detailRow} testID={`subthreads-card-permission-${row.id}`}>
              <Text style={styles.detailText} numberOfLines={2}>
                {t("subthreads.card.waitingOn", { title: detail.pendingPermission })}
              </Text>
              <Button
                size="sm"
                variant="outline"
                onPress={onPeek}
                accessibilityHint={t("subthreads.card.reviewHint")}
                testID={`subthreads-card-review-${row.id}`}
              >
                {t("subthreads.card.review")}
              </Button>
            </View>
          ) : null}
          {detail.tasks ? (
            <Text style={styles.meta} numberOfLines={1} testID={`subthreads-card-tasks-${row.id}`}>
              {[
                t("subthreads.card.tasks", { done: detail.tasks.done, total: detail.tasks.total }),
                detail.tasks.current,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </>
      )}
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="secondary"
          onPress={onPeek}
          testID={`subthreads-card-peek-${row.id}`}
        >
          {t("subthreads.card.peek")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onPress={handleOpenInTab}
          testID={`subthreads-card-open-in-tab-${row.id}`}
        >
          {t("subthreads.openInTab")}
        </Button>
        {row.kind === "paseo" ? (
          <CardOverflowMenu row={row} label={label} onArchive={onArchive} onDetach={onDetach} />
        ) : null}
      </View>
    </View>
  );
}

function CardOverflowMenu({
  row,
  label,
  onArchive,
  onDetach,
}: {
  row: SubthreadRow;
  label: string;
  onArchive: (agentId: string) => void;
  onDetach?: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleArchive = useCallback(() => onArchive(row.id), [onArchive, row.id]);
  const handleDetach = useCallback(() => onDetach?.(row.id), [onDetach, row.id]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("subthreads.card.more", { label })}
        style={overflowStyle}
        testID={`subthreads-card-more-${row.id}`}
      >
        <ThemedEllipsis size={CARD_ICON_SIZE} uniProps={mutedIconColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" minWidth={180}>
        {onDetach ? (
          <DropdownMenuItem onSelect={handleDetach} testID={`subthreads-card-detach-${row.id}`}>
            {t("subthreads.card.detach")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={handleArchive} testID={`subthreads-card-archive-${row.id}`}>
          {t("subthreads.card.archive")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function cardMainStyle({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) {
  return [styles.cardMain, pressed || hovered ? styles.cardMainActive : null];
}

function chevronStyle({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) {
  return [styles.chevron, pressed || hovered ? styles.headingActive : null];
}

function overflowStyle({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) {
  return [styles.chevron, pressed || hovered ? styles.headingActive : null];
}

const styles = StyleSheet.create((theme) => ({
  drawer: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  // The thread header carries two lines (target and path), so it grows past the one-line
  // toolbar height instead of clipping the path.
  threadToolbar: {
    flexDirection: "row",
    alignItems: "center",
    height: "auto",
    minHeight: theme.spacing[12],
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  modeSwitch: {
    flexShrink: 0,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    paddingLeft: theme.spacing[1],
  },
  targetBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  readOnlyStrip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  thread: {
    flex: 1,
    minHeight: 0,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  groups: {
    gap: theme.spacing[3],
  },
  group: {
    gap: theme.spacing[1],
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  // Group headings: small uppercase muted labels on the list's left rail.
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minHeight: 32,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  headingActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  groupHeading: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: theme.colors.foregroundMuted,
  },
  groupSummary: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  // Cards are rows separated by hairlines inside one bordered list, not floating boxes.
  cardList: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  card: {
    backgroundColor: theme.colors.surface0,
  },
  cardDivider: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    gap: 2,
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    paddingVertical: theme.spacing[2],
  },
  cardMainActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  cardLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
  },
  markSlot: {
    width: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  cardState: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  providerIcon: {
    width: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardSecondary: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  // A waiting approval is the one line the parent's user must act on; it reads as content.
  activityBlocker: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  cardTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1.5],
    paddingRight: theme.spacing[1.5],
  },
  age: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  chevron: {
    minWidth: 28,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  detail: {
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2] + 12 + theme.spacing[1.5],
    paddingRight: theme.spacing[3],
    paddingBottom: theme.spacing[3],
  },
  detailText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  detailReport: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  linkText: {
    marginTop: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textDecorationLine: "underline",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
