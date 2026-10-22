import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { Pencil, RotateCw, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";

import { DeliveryMark } from "@/components/delivery-mark";
import {
  describeDirectSendAttention,
  discardDirectSend,
  editDirectSend,
  retryDirectSend,
} from "@/composer/delivery-actions";
import { needsDirectSendAttention } from "@/composer/delivery-state";
import { useSessionStore } from "@/stores/session-store";
import { useSendOutboxStore, type PendingDirectSend } from "@/stores/send-outbox-store";
import type { SendOutboxFlushClient } from "@/stores/send-outbox-store/model";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedRotate = withUnistyles(RotateCw);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);
const iconMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * Direct sends saved on this device that no live chat bubble represents, e.g.
 * after the app was killed while the host was unreachable. They retry on every
 * reconnect; this track makes them visible and recoverable until then.
 * See docs/queue-mirroring.md, "Direct sends".
 */
export function UnsentTrack({
  serverId,
  agentId,
  client,
  getComposerText,
  restoreComposerText,
}: {
  serverId: string;
  agentId: string;
  client: SendOutboxFlushClient | null;
  getComposerText: () => string;
  restoreComposerText: (text: string) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const entries = useSendOutboxStore((state) => state.entries);
  const liveSubmissionIds = useSessionStore(
    useShallow((state) =>
      (state.sessions[serverId]?.messageSubmissions.get(agentId) ?? []).map(
        (submission) => submission.clientMessageId,
      ),
    ),
  );
  const rows = useMemo(() => {
    const live = new Set(liveSubmissionIds);
    return Object.values(entries)
      .filter(
        (entry) =>
          entry.serverId === serverId &&
          entry.agentId === agentId &&
          !live.has(entry.clientMessageId),
      )
      .sort((left, right) => left.createdAt - right.createdAt);
  }, [agentId, entries, liveSubmissionIds, serverId]);

  if (rows.length === 0) return null;
  return (
    <View style={styles.track} testID="composer-unsent-track">
      <Text style={styles.header}>
        {t("composer.delivery.unsentHeader", { count: rows.length })}
      </Text>
      {rows.map((entry) => (
        <UnsentRow
          key={entry.clientMessageId}
          entry={entry}
          client={client}
          getComposerText={getComposerText}
          restoreComposerText={restoreComposerText}
        />
      ))}
    </View>
  );
}

const UnsentRow = memo(function UnsentRow({
  entry,
  client,
  getComposerText,
  restoreComposerText,
}: {
  entry: PendingDirectSend;
  client: SendOutboxFlushClient | null;
  getComposerText: () => string;
  restoreComposerText: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [isBusy, setIsBusy] = useState(false);
  const attention = needsDirectSendAttention(entry);
  const run = useCallback(async (action: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      console.warn("[UnsentTrack] Action failed", error);
    } finally {
      setIsBusy(false);
    }
  }, []);
  const handleRetry = useCallback(() => {
    if (!client) return;
    void run(() => retryDirectSend({ entry, client }));
  }, [client, entry, run]);
  const handleEdit = useCallback(
    () =>
      void run(() =>
        editDirectSend({
          entry,
          currentText: getComposerText(),
          restoreText: restoreComposerText,
        }),
      ),
    [entry, getComposerText, restoreComposerText, run],
  );
  const handleDiscard = useCallback(() => void run(() => discardDirectSend(entry)), [entry, run]);

  return (
    <View style={styles.row} testID={`unsent-message-${entry.clientMessageId}`}>
      <View style={styles.content}>
        <Text style={styles.text} numberOfLines={2} ellipsizeMode="tail">
          {entry.text}
        </Text>
        <View style={styles.status}>
          <DeliveryMark state={attention ? "attention" : "pending"} />
          <Text style={[styles.statusText, attention && styles.attentionText]} numberOfLines={2}>
            {attention ? describeDirectSendAttention(entry) : t("composer.delivery.unsentPending")}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={handleRetry}
          disabled={isBusy || !client}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={t("composer.delivery.retryNow")}
        >
          <ThemedRotate size={ICON_SIZE.sm} uniProps={iconMapping} />
        </Pressable>
        {entry.rejectedError !== undefined ? (
          <Pressable
            onPress={handleEdit}
            disabled={isBusy}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel={t("composer.delivery.editUnsent")}
          >
            <ThemedPencil size={ICON_SIZE.sm} uniProps={iconMapping} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleDiscard}
          disabled={isBusy}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={t("composer.delivery.discardUnsent")}
        >
          <ThemedTrash size={ICON_SIZE.sm} uniProps={iconMapping} />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  track: {
    flexDirection: "column",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  header: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
    marginLeft: -theme.spacing[1],
  },
  statusText: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  attentionText: {
    color: theme.colors.statusWarning,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  action: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
}));
