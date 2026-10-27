import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeatureAvailability } from "@/runtime/host-features";
import { useCommandCenterActions } from "@/command-center/provider";
import type { CommandCenterContribution } from "@/command-center/contributions";
import { loadFirstMessage } from "./load";

interface Target {
  serverId: string;
  agentId: string;
}

export function useFirstMessage(serverId: string, agentId: string | undefined) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = useCallback(() => {
    if (agentId) setOpenFor(`${serverId}:${agentId}`);
  }, [serverId, agentId]);
  const close = useCallback(() => setOpenFor(null), []);
  const actions = useMemo<CommandCenterContribution[]>(
    () => [
      {
        id: "conversation-first-message",
        group: "conversation",
        groupRank: 15,
        rank: 11,
        keywords: ["first", "original", "prompt", "beginning"],
        visibility: "always",
        presentation: { kind: "action", title: t("firstMessage.title") },
        run: open,
      },
    ],
    [t, open],
  );
  useCommandCenterActions({
    sourceId: `first-message:${serverId}:${agentId ?? "none"}`,
    enabled: focused && !!agentId,
    actions,
  });
  return {
    open,
    sheet:
      focused && agentId && openFor === `${serverId}:${agentId}` ? (
        <FirstMessageSheet key={openFor} serverId={serverId} agentId={agentId} onClose={close} />
      ) : null,
  };
}

function FirstMessageSheet({ serverId, agentId, onClose }: Target & { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  // COMPAT(agentTimelinePromptIndex): added in v0.2.X; remove when floor >= v0.2.X.
  const supported = useHostFeatureAvailability(serverId, "agentTimelinePromptIndex");
  const message = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryKey: ["first-message", serverId, agentId],
    queryFn: async () => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error("Host disconnected");
      return loadFirstMessage(client, agentId);
    },
    enabled: supported === true,
    retry: false,
    gcTime: 0,
  });
  const timestamp = message.data
    ? new Date(message.data.timestamp).toLocaleString(i18n.language)
    : undefined;
  const header = useMemo(
    () => ({ title: t("firstMessage.title"), subtitle: timestamp }),
    [t, timestamp],
  );
  const refetch = message.refetch;
  const retry = useCallback(() => void refetch(), [refetch]);
  let content: ReactNode;
  if (supported === false) {
    content = <Text style={styles.hint}>{t("firstMessage.updateHost")}</Text>;
  } else if (supported === null || message.isFetching) {
    content = (
      <Text style={styles.hint} accessibilityLiveRegion="polite">
        {t("firstMessage.loading")}
      </Text>
    );
  } else if (message.isError) {
    content = (
      <Alert variant="error" description={t("firstMessage.error")} testID="first-message-error">
        <Button variant="outline" size="sm" onPress={retry}>
          {t("common.actions.retry")}
        </Button>
      </Alert>
    );
  } else if (message.data) {
    content = (
      <Text selectable style={styles.message} testID="first-message-text">
        {message.data.text || t("firstMessage.noText")}
      </Text>
    );
  } else {
    content = (
      <Text style={styles.hint} testID="first-message-empty">
        {t("firstMessage.empty")}
      </Text>
    );
  }
  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={header}
      desktopMaxWidth={720}
      testID="first-message-sheet"
    >
      <View style={styles.content}>{content}</View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[4], paddingVertical: theme.spacing[4] },
  message: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.content,
    lineHeight: Math.round(theme.fontSize.content * 1.4),
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
  },
}));
