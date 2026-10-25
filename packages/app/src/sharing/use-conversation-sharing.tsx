import { useIsFocused } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useSharingAvailability } from "./availability";
import { useCommandCenterActions } from "@/command-center/provider";
import type { CommandCenterContribution } from "@/command-center/contributions";
import { useShareLinks } from "./use-share-links";
import { ShareSheet } from "./share-sheet";

export function useConversationSharing(serverId: string, agentId: string | undefined) {
  const availability = useSharingAvailability(serverId);
  const { t } = useTranslation();
  const focused = useIsFocused();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const { client, data, refetch } = useShareLinks(
    serverId,
    agentId,
    availability === true && !!agentId,
  );
  const open = useCallback(() => {
    if (agentId) setOpenFor(`${serverId}:${agentId}`);
  }, [serverId, agentId]);
  const close = useCallback(() => setOpenFor(null), []);
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const actions = useMemo<CommandCenterContribution[]>(
    () => [
      {
        id: "conversation-share",
        group: "conversation",
        groupRank: 15,
        rank: 10,
        keywords: ["share", "snapshot", "link"],
        visibility: "always",
        presentation: { kind: "action", title: t("sharing.action") },
        run: open,
      },
    ],
    [t, open],
  );
  useCommandCenterActions({
    sourceId: `sharing:${serverId}:${agentId ?? "none"}`,
    enabled: focused && availability === true && !!agentId,
    actions,
  });
  const shares = data ?? [];
  return {
    availability: agentId ? availability : null,
    open,
    badge: shares.some(
      (share) =>
        share.revokedAt === null &&
        (share.expiresAt === null || Date.parse(share.expiresAt) > Date.now()),
    ) ? (
      <Text style={styles.badge} testID="conversation-shared-badge">
        {t("sharing.shared")}
      </Text>
    ) : null,
    sheet:
      client && agentId && availability === true && openFor === `${serverId}:${agentId}` ? (
        <ShareSheet
          key={`${serverId}:${agentId}`}
          client={client}
          agentId={agentId}
          shares={shares}
          onClose={close}
          refresh={refresh}
        />
      ) : null,
  };
}
const styles = StyleSheet.create((theme) => ({
  badge: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
}));
