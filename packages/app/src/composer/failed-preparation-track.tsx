import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { failedPreparationRecovery } from "@/composer/submission/preparation-recovery-store";
import type { FailedPreparation } from "@/composer/submission/preparation-recovery";
import type { ComposerAttachment } from "@/attachments/types";

interface FailedPreparationTrackProps {
  scopeKey: string;
  onRestore: (id: string) => Promise<void>;
}

export function FailedPreparationTrack({ scopeKey, onRestore }: FailedPreparationTrackProps) {
  const { t } = useTranslation();
  const entries = useSyncExternalStore(
    failedPreparationRecovery.subscribe,
    failedPreparationRecovery.getSnapshot,
    failedPreparationRecovery.getSnapshot,
  );
  const rows = useMemo(
    () => entries.filter((entry) => entry.scopeKey === scopeKey),
    [entries, scopeKey],
  );
  if (rows.length === 0) return null;
  return (
    <View style={styles.track} testID="failed-preparation-track">
      <Text style={styles.header}>
        {t("composer.delivery.recoveryHeader", { count: rows.length })}
      </Text>
      <Text style={styles.detail}>{t("composer.delivery.recoveryMemory")}</Text>
      <ScrollView style={styles.rows} contentContainerStyle={styles.rowList}>
        {rows.map((entry) => (
          <FailedPreparationRow key={entry.id} entry={entry} onRestore={onRestore} />
        ))}
      </ScrollView>
    </View>
  );
}

function FailedPreparationRow({
  entry,
  onRestore,
}: {
  entry: FailedPreparation<ComposerAttachment>;
  onRestore: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const restore = useCallback(() => {
    void onRestore(entry.id).catch(() => undefined);
  }, [entry.id, onRestore]);
  const discard = useCallback(() => failedPreparationRecovery.discard(entry.id), [entry.id]);
  return (
    <View style={styles.row} testID={`failed-preparation-${entry.id}`}>
      <Text selectable numberOfLines={3} style={styles.message}>
        {entry.message}
      </Text>
      <Text style={styles.detail}>
        {t("composer.delivery.recoveryAttachments", { count: entry.attachments.length })}
      </Text>
      <Text style={styles.error} accessibilityRole="alert">
        {entry.error}
      </Text>
      <View style={styles.actions}>
        <Button
          variant="outline"
          size="sm"
          onPress={restore}
          disabled={entry.isRestoring}
          accessibilityLabel={t("composer.delivery.restoreFailed")}
        >
          {t("composer.delivery.restoreFailed")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={discard}
          disabled={entry.isRestoring}
          accessibilityLabel={t("composer.delivery.discardFailed")}
        >
          {t("composer.delivery.discardFailed")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  track: { gap: theme.spacing[2], paddingBottom: theme.spacing[2] },
  rows: { maxHeight: 240 },
  rowList: { gap: theme.spacing[2] },
  header: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  row: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  message: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  detail: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.statusWarning, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
