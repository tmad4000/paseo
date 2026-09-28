import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { PaneFind, type PaneFindHandle } from "@/pane-find";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useAgentViewStore } from "@/stores/agent-view-store";
import { planTimelinePromptJump } from "@/timeline/timeline-sync-plan";
import { ChatFindModel, type ChatFindFailure } from "./model";
import { createNativeFindViewport } from "./viewport";
import type { ChatFindProps, ChatFindExpansionProps } from "./types";

/**
 * Native chat find. The search model, host RPC and history loading are the same as
 * the web wrapper's; only the viewport differs (see `viewport.ts`), and the widget is
 * opened from the tab menu through `useAgentViewStore` instead of Cmd+F.
 */

const Selected = createContext<string | null>(null);
const FAILURE_TEXT: Record<ChatFindFailure, string> = {
  connection: "paneFind.connectionFailure",
  historyChanged: "paneFind.historyChangedFailure",
  reveal: "paneFind.revealFailure",
};

export function useChatFindSelectedMessageId(): string | null {
  return useContext(Selected);
}

/** Native cannot highlight a range inside a rendered row, so the selected row is tinted. */
export function ChatFindExpansion({ messageId, children }: ChatFindExpansionProps) {
  const selected = useChatFindSelectedMessageId() === messageId;
  return <View style={selected ? styles.selectedRow : undefined}>{children(selected)}</View>;
}

export function ChatFind({
  agentId,
  serverId,
  epoch,
  items,
  viewportRef,
  revealLoadedMessage,
  visibleMessageIds,
  children,
}: ChatFindProps) {
  const { t } = useTranslation();
  const widget = useRef<PaneFindHandle>(null);
  const bindings = useRef({ viewportRef, revealLoadedMessage, visibleMessageIds, items });
  bindings.current = { viewportRef, revealLoadedMessage, visibleMessageIds, items };
  const active = useRetainedPanelActive();
  // COMPAT(agentHistorySearch): upstream flag, added in v0.3.0. The widget stays
  // reachable on an older host and explains itself instead of hiding.
  const supported = useHostFeature(serverId, "agentHistorySearch");
  const key = `${serverId}:${agentId}`;
  const requested = useAgentViewStore((state) => state.findOpen[key] ?? false);
  const setFindOpen = useAgentViewStore((state) => state.setFindOpen);
  const model = useMemo(
    () =>
      new ChatFindModel({
        search(query, cursor) {
          const client = getHostRuntimeStore().getClient(serverId);
          if (!client) return Promise.reject(new Error("Host disconnected"));
          return client.searchAgentTimeline({ agentId, query, cursor });
        },
        load(targetEpoch, seq) {
          return getHostRuntimeStore().fetchAgentTimeline(
            serverId,
            agentId,
            planTimelinePromptJump({ epoch: targetEpoch, seq }),
          );
        },
        ...createNativeFindViewport({ getBindings: () => bindings.current }),
      }),
    [agentId, serverId],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    model.updateHistory(epoch, items);
  }, [model, epoch, items]);
  useEffect(() => () => model.close(), [model]);
  const close = useCallback(() => {
    setFindOpen(serverId, agentId, false);
    model.close();
  }, [agentId, model, serverId, setFindOpen]);
  useEffect(() => {
    if (!active) close();
  }, [active, close]);
  useEffect(() => {
    if (requested) {
      model.open();
      widget.current?.focus();
    } else {
      model.close();
    }
  }, [model, requested]);
  const setQuery = useCallback(
    (query: string) => {
      if (supported) model.setQuery(query);
    },
    [model, supported],
  );
  let status = "";
  if (!supported) status = t("paneFind.updateHost");
  else if (state.phase === "searching") status = t("paneFind.searching");
  else if (state.phase === "loading") status = t("paneFind.loading");
  else if (state.phase === "error") status = t("paneFind.failed");
  else if (state.query.trim())
    status = state.count
      ? t("paneFind.position", { current: state.occurrence + 1, total: state.count })
      : t("paneFind.noMatches");
  return (
    <View style={styles.root}>
      <Selected.Provider value={state.selectedItemId}>{children}</Selected.Provider>
      {state.open ? (
        <View style={styles.overlay} pointerEvents="box-none">
          <PaneFind
            ref={widget}
            query={state.query}
            status={status}
            canNavigate={supported && state.phase === "ready" && state.count > 0}
            onQueryChange={setQuery}
            onNext={model.next}
            onPrevious={model.previous}
            onClose={close}
          />
          {supported && state.failure ? (
            <View style={styles.error}>
              <Text style={styles.errorText}>{t(FAILURE_TEXT[state.failure])}</Text>
              <Button size="xs" variant="ghost" onPress={model.retry}>
                {t("paneFind.retry")}
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0 },
  overlay: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[3],
    left: theme.spacing[3],
    zIndex: 10,
    alignItems: "flex-end",
  },
  error: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
  },
  errorText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, flex: 1 },
  selectedRow: { backgroundColor: theme.colors.surface2 },
}));
