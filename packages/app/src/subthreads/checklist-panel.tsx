import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { RotateCw, SquareArrowOutUpRight, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { CompanionFeed } from "@/companion-stream/feed";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import {
  PaneContentToolbar,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { openExternalUrl } from "@/utils/open-external-url";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { ChecklistFrame } from "./checklist-frame";
import { SidePanelModeSwitch, SUBTHREADS_TOGGLE_SHORTCUT_ID } from "./mode-switch";
import type { SidePanelMode } from "./model";

const ThemedReload = withUnistyles(RotateCw);
const ThemedOpenExternal = withUnistyles(SquareArrowOutUpRight);
const ThemedX = withUnistyles(X);
const TOOLBAR_ICON_SIZE = 16;
const NO_ENTRIES: readonly CompanionEntry[] = [];
const NO_ARTIFACTS: readonly never[] = [];

export interface ChecklistPanelProps {
  serverId: string;
  agentId: string;
  cwd: string;
  /** The linked checklist page; null shows this session's own Stream instead. */
  url: string | null;
  showModeSwitch: boolean;
  onModeChange: (mode: SidePanelMode) => void;
  onClose: () => void;
  /** The Stream's "back to chat" / "reply in chat": the chat is already beside it. */
  onFocusParent: () => void;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
}

/**
 * A checklist beside the conversation. A linked page (an agent sets it on the session) is
 * embedded as-is and keeps its own state; without one, the panel shows this session's Stream.
 */
export function ChecklistPanel({
  serverId,
  agentId,
  cwd,
  url,
  showModeSwitch,
  onModeChange,
  onClose,
  onFocusParent,
  onOpenWorkspaceFile,
}: ChecklistPanelProps): ReactElement {
  const { t } = useTranslation();
  const shortcut = useShortcutKeys(SUBTHREADS_TOGGLE_SHORTCUT_ID);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const openExternally = useCallback(() => {
    if (url) void openExternalUrl(url);
  }, [url]);
  const host = useMemo(() => (url ? new URL(url).host : null), [url]);

  return (
    <View style={styles.panel} testID="session-checklist-panel">
      <PaneContentToolbar style={styles.toolbar} testID="session-checklist-header">
        {showModeSwitch ? (
          <View style={styles.grow}>
            <SidePanelModeSwitch mode="checklist" onModeChange={onModeChange} />
          </View>
        ) : (
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {t("sidePanel.checklist")}
            </Text>
          </View>
        )}
        <ToolbarControls>
          {url ? (
            <>
              <ToolbarButton
                label={t("sidePanel.reloadChecklist")}
                onPress={reload}
                testID="session-checklist-reload"
              >
                <ThemedReload size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
              </ToolbarButton>
              <ToolbarButton
                label={t("sidePanel.openChecklistExternally")}
                onPress={openExternally}
                testID="session-checklist-open-external"
              >
                <ThemedOpenExternal size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
              </ToolbarButton>
            </>
          ) : null}
          <ToolbarButton
            label={t("sidePanel.close")}
            shortcut={shortcut}
            onPress={onClose}
            testID="session-side-panel-close"
          >
            <ThemedX size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
          </ToolbarButton>
        </ToolbarControls>
      </PaneContentToolbar>
      {url && host ? (
        <>
          <View style={styles.sourceStrip}>
            <Text style={styles.meta} numberOfLines={1} testID="session-checklist-source">
              {t("sidePanel.linkedChecklistFrom", { host })}
            </Text>
          </View>
          <View style={styles.body}>
            <ChecklistFrame url={url} title={t("sidePanel.checklist")} reloadKey={reloadKey} />
          </View>
        </>
      ) : (
        <SessionStream
          serverId={serverId}
          agentId={agentId}
          cwd={cwd}
          onFocusParent={onFocusParent}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
        />
      )}
    </View>
  );
}

function SessionStream({
  serverId,
  agentId,
  cwd,
  onFocusParent,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId: string;
  cwd: string;
  onFocusParent: () => void;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
}): ReactElement {
  const { t } = useTranslation();
  // COMPAT(companionStream): same gate as the Chat / Stream switcher.
  const streamSupported = useHostFeature(serverId, "companionStream");
  const artifactsSupported = useHostFeature(serverId, "artifactFeed");
  const entries = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))?.companionEntries ??
      NO_ENTRIES
    );
  });
  const artifacts = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))?.artifacts ??
      NO_ARTIFACTS
    );
  });
  if (!streamSupported && !artifactsSupported) {
    return (
      <View style={styles.empty} testID="session-checklist-empty">
        <Text style={styles.meta}>{t("sidePanel.noChecklist")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.body} testID="session-checklist-stream">
      <CompanionFeed
        serverId={serverId}
        agentId={agentId}
        cwd={cwd}
        entries={entries}
        artifacts={artifacts}
        isSupported={streamSupported}
        artifactsSupported={artifactsSupported}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
        onReturnToChat={onFocusParent}
        onReplyInChat={onFocusParent}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
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
  grow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    paddingLeft: theme.spacing[1],
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
  sourceStrip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
}));
