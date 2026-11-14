import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Keyboard, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Search } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { iconButtonChromeStyle } from "@/components/ui/icon-button-chrome";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { setCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { isWeb } from "@/constants/platform";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { buildWorkspaceKeyboardHandlerId } from "@/keyboard/handler-id";
import {
  WorkspaceTabOptionRow,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import {
  useWorkspaceLayoutStore,
  selectExplorerSidebarPaneId,
} from "@/stores/workspace-layout-store";
import { collectWorkspaceTabSearchEntries, type WorkspaceTabSearchEntry } from "./search";
import { filterAndRankComboboxOptions } from "@/components/ui/combobox-options";
import type { Theme } from "@/styles/theme";

const actionDataSet = { comboboxAction: "true" };
const ThemedSearch = withUnistyles(Search);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface WorkspaceTabSearchRow {
  entry: WorkspaceTabSearchEntry;
  presentation: WorkspaceTabPresentation;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}

interface Props {
  workspaceKey: string | null;
  serverId: string;
  workspaceId: string;
  workspaceName: string;
  activeTabId: string;
  enabled: boolean;
  onSelect: (tabId: string) => void;
  /** The compact active-title trigger; desktop uses the persistent search icon. */
  compactTrigger?: ReactNode;
  renderRow?: (row: WorkspaceTabSearchRow) => ReactElement;
  hideTrigger?: boolean;
}

function ReportPresentation({
  presentation,
  onResolve,
}: {
  presentation: WorkspaceTabPresentation;
  onResolve: (presentation: WorkspaceTabPresentation) => void;
}) {
  useEffect(() => onResolve(presentation), [onResolve, presentation]);
  return null;
}

export function WorkspaceTabSearchHeader({ hidden, ...props }: Props & { hidden: boolean }) {
  return hidden ? null : <WorkspaceTabSearchPicker {...props} />;
}

/** Focus mode removes the header, but keeps its workspace action available. */
export function WorkspaceTabSearchWithoutHeader({
  showHeader,
  ...props
}: Props & { showHeader: boolean }) {
  return showHeader ? null : <WorkspaceTabSearchPicker {...props} hideTrigger />;
}

/** Only descriptors mount here, never panel content. Filtering is entirely local. */
export function WorkspaceTabSearchPicker({
  workspaceKey: workspaceKeyInput,
  serverId,
  workspaceId,
  workspaceName,
  activeTabId,
  enabled,
  onSelect,
  compactTrigger,
  renderRow,
  hideTrigger,
}: Props) {
  const workspaceKey = workspaceKeyInput ?? "";
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [keyboardInvocation, setKeyboardInvocation] = useState(false);
  const [query, setQuery] = useState("");
  const [presentations, setPresentations] = useState<ReadonlyMap<string, WorkspaceTabPresentation>>(
    new Map(),
  );
  const anchorRef = useRef<View>(null);
  const invocationFocusRef = useRef<HTMLElement | null>(null);
  const shortcutKeys = useShortcutKeys("workspace-tab-search");
  const layout = useWorkspaceLayoutStore((state) => state.layoutByWorkspace[workspaceKey] ?? null);
  const explorerPaneId = useWorkspaceLayoutStore((state) =>
    selectExplorerSidebarPaneId(state, workspaceKey),
  );
  const entries = useMemo(
    () => collectWorkspaceTabSearchEntries(layout, explorerPaneId),
    [layout, explorerPaneId],
  );
  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.tab.tabId, entry])),
    [entries],
  );
  const onResolve = useCallback((presentation: WorkspaceTabPresentation) => {
    setPresentations((previous) => {
      if (previous.get(presentation.key) === presentation) return previous;
      return new Map(previous).set(presentation.key, presentation);
    });
  }, []);
  const openPicker = useCallback(
    (keyboard = false) => {
      // Repeated invocations keep the query, highlight and original focus-return target.
      if (!open && isWeb) {
        invocationFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      setKeyboardInvocation(keyboard);
      if (!keyboard) Keyboard.dismiss();
      setOpen(true);
    },
    [open],
  );
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);
  useKeyboardActionHandler({
    handlerId: buildWorkspaceKeyboardHandlerId({
      name: "workspace-tab-search",
      serverId,
      workspaceId,
    }),
    enabled,
    priority: 20,
    actions: ["workspace.tab.search"],
    handle: () => {
      openPicker(true);
      return true;
    },
  });
  const contextFor = useCallback(
    (entry: WorkspaceTabSearchEntry) =>
      [
        entry.explorer
          ? t("workspace.tabs.search.explorer")
          : t("workspace.tabs.search.pane", { number: entry.paneNumber }),
        entry.hidden ? t("workspace.tabs.search.hidden") : null,
        entry.tab.tabId === activeTabId ? t("workspace.tabs.search.current") : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [activeTabId, t],
  );
  const rowPresentations = useMemo(() => {
    const rows = new Map<string, WorkspaceTabPresentation>();
    for (const entry of entries) {
      const presentation = presentations.get(entry.tab.tabId);
      if (presentation)
        rows.set(entry.tab.tabId, {
          ...presentation,
          subtitle: [presentation.subtitle, contextFor(entry)].filter(Boolean).join(" · "),
        });
    }
    return rows;
  }, [contextFor, entries, presentations]);
  const options = useMemo<ComboboxOption[]>(
    () =>
      [...rowPresentations.values()].map((presentation) => ({
        id: presentation.key,
        label: presentation.label,
        description: presentation.subtitle,
      })),
    [rowPresentations],
  );
  const hasUnresolvedTitles = useMemo(
    () =>
      entries.some((entry) => {
        const presentation = presentations.get(entry.tab.tabId);
        return !presentation || presentation.titleState === "loading";
      }),
    [entries, presentations],
  );
  const visibleCount = useMemo(
    () => filterAndRankComboboxOptions(options, query.trim().toLowerCase()).length,
    [options, query],
  );
  const resolveRow = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => {
      const entry = entryById.get(option.id);
      const presentation = rowPresentations.get(option.id);
      if (!entry || !presentation) return <View />;
      return renderRow ? (
        renderRow({ entry, presentation, selected, active, onPress })
      ) : (
        <WorkspaceTabOptionRow
          presentation={presentation}
          selected={selected}
          active={active}
          onPress={onPress}
          showSubtitle
        />
      );
    },
    [entryById, rowPresentations, renderRow],
  );
  const selectExistingTab = useCallback(
    (tabId: string) => {
      const select = () => {
        // A close can race pointer/keyboard selection; never reopen a vanished result.
        const state = useWorkspaceLayoutStore.getState();
        const current = state.layoutByWorkspace[workspaceKey] ?? null;
        if (
          collectWorkspaceTabSearchEntries(
            current,
            selectExplorerSidebarPaneId(state, workspaceKey),
          ).some((entry) => entry.tab.tabId === tabId)
        )
          onSelect(tabId);
      };
      // Let the overlay return invocation focus first. Returning to an old composer's
      // focus handler after this jump would otherwise select the old pane again.
      if (isWeb) requestAnimationFrame(select);
      else select();
    },
    [onSelect, workspaceKey],
  );
  const searchSessions = useCallback(() => {
    const initialQuery = query;
    setOpen(false);
    const openCenter = () => {
      if (isWeb)
        setCommandCenterFocusRestoreElement(
          invocationFocusRef.current?.isConnected ? invocationFocusRef.current : null,
        );
      useKeyboardShortcutsStore.getState().setCommandCenterOpen(true, null, initialQuery);
    };
    if (isWeb) requestAnimationFrame(openCenter);
    else openCenter();
  }, [query]);
  const label = t("workspace.tabs.search.action");
  const triggerState = useMemo(() => ({ expanded: open }), [open]);
  const handleTriggerPress = useCallback(() => openPicker(), [openPicker]);
  const triggerStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) =>
      compactTrigger
        ? [styles.compactTrigger, (pressed || hovered) && styles.triggerActive]
        : iconButtonChromeStyle({ size: "large", state: { pressed, hovered, open } }),
    [compactTrigger, open],
  );
  const summary = useMemo(
    () => (
      <View>
        {!compactTrigger ? (
          <Text style={styles.title}>{t("workspace.tabs.search.title")}</Text>
        ) : null}
        {shortcutKeys ? (
          <View style={styles.shortcutHint}>
            <Shortcut chord={shortcutKeys} />
          </View>
        ) : null}
        <Text style={styles.context} accessibilityLiveRegion="polite">
          {workspaceName} · {t("workspace.tabs.search.results", { count: visibleCount })}
        </Text>
      </View>
    ),
    [compactTrigger, shortcutKeys, t, visibleCount, workspaceName],
  );
  const trigger = (
    <Pressable
      ref={anchorRef}
      testID={compactTrigger ? "workspace-tab-switcher-trigger" : "workspace-tab-search-trigger"}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={triggerState}
      onPress={handleTriggerPress}
      style={triggerStyle}
    >
      {compactTrigger ?? <ThemedSearch size={16} uniProps={mutedColor} />}
    </Pressable>
  );
  let triggerNode: ReactNode = trigger;
  if (hideTrigger) triggerNode = <View ref={anchorRef} style={styles.keyboardAnchor} />;
  else if (!compactTrigger)
    triggerNode = (
      <Tooltip enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="bottom">
          <View style={styles.tooltip}>
            <Text style={styles.context}>{label}</Text>
            {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
          </View>
        </TooltipContent>
      </Tooltip>
    );
  const broaderSearchFooter = useMemo(
    () => (
      <Pressable
        accessibilityRole="button"
        testID="workspace-tab-search-sessions"
        dataSet={actionDataSet}
        onPress={searchSessions}
        style={styles.broaderSearch}
      >
        <Text style={styles.broaderSearchLabel}>
          {t("workspace.tabs.search.sessions", {
            defaultValue: "Search sessions and workspaces…",
          })}
        </Text>
      </Pressable>
    ),
    [searchSessions, t],
  );
  return (
    <View>
      {triggerNode}
      {open
        ? entries.map(({ tab }) => (
            <WorkspaceTabPresentationResolver
              key={tab.tabId}
              tab={tab}
              serverId={tab.scope?.serverId ?? serverId}
              workspaceId={tab.scope?.workspaceId ?? workspaceId}
            >
              {(presentation) => (
                <ReportPresentation presentation={presentation} onResolve={onResolve} />
              )}
            </WorkspaceTabPresentationResolver>
          ))
        : null}
      <Combobox
        options={options}
        value={activeTabId}
        open={open}
        onOpenChange={setOpen}
        onSelect={selectExistingTab}
        onSearchQueryChange={setQuery}
        anchorRef={anchorRef}
        title={t("workspace.tabs.search.title")}
        searchPlaceholder={t("workspace.tabs.search.placeholder")}
        emptyText={
          hasUnresolvedTitles ? t("workspace.tabs.loading") : t("workspace.tabs.search.empty")
        }
        stickyHeader={summary}
        footer={broaderSearchFooter}
        desktopMinWidth={440}
        desktopPreventInitialFlash
        preserveActiveOption
        autoFocusSearch={keyboardInvocation}
        renderOption={resolveRow}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  broaderSearch: { minHeight: 44, justifyContent: "center", paddingHorizontal: theme.spacing[3] },
  broaderSearchLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  shortcutHint: { position: "absolute", top: theme.spacing[3], right: theme.spacing[3] },
  keyboardAnchor: { position: "absolute", top: 8, right: 8, width: 1, height: 1 },
  compactTrigger: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  triggerActive: { backgroundColor: theme.colors.surface1 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
  },
  context: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  tooltip: { flexDirection: "row", alignItems: "center" },
}));
