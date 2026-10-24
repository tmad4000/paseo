import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Share, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ShareRecordPayload, ShareSnapshot } from "@getpaseo/protocol/sharing";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { ScrollView } from "@/components/ui/scroll-view";
import { SettingsCard, SettingsSwitch } from "@/components/settings";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useShareForm } from "./use-share-form";
import { type ShareFormModel } from "./share-form-model";
import { confirmDialog } from "@/utils/confirm-dialog";

export function SharePreview({ snapshot }: { snapshot: ShareSnapshot }) {
  const { t } = useTranslation();
  const summary = snapshot.redactionSummary;
  return (
    <View style={styles.preview} testID="share-preview">
      <Text style={styles.muted}>
        {t("sharing.summary", {
          tools: summary.hiddenToolCalls,
          reasoning: summary.hiddenReasoning,
          secrets: summary.secretsMasked,
          paths: summary.pathsCollapsed,
          contacts: summary.contactsMasked,
        })}
      </Text>
      <ScrollView style={styles.previewScroll} nestedScrollEnabled>
        {snapshot.messages.map((message) =>
          message.kind === "omitted" ? (
            <Text key={message.id} style={styles.omitted}>
              {t(`sharing.omitted.${message.reason}`, { count: message.count })}
            </Text>
          ) : (
            <View key={message.id} style={styles.message}>
              <Text style={styles.author}>
                {message.kind === "user" ? message.author.name : t("sharing.assistant")}
              </Text>
              <Text selectable style={styles.text}>
                {message.text}
              </Text>
            </View>
          ),
        )}
      </ScrollView>
    </View>
  );
}
function ShareRecordRow({
  client,
  share,
  refresh,
}: {
  client: DaemonClient;
  share: ShareRecordPayload;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (remove: boolean) => {
      if (busy) return;
      if (
        remove &&
        !(await confirmDialog({
          title: t("sharing.delete"),
          message: t("sharing.deleteMessage"),
          confirmLabel: t("sharing.delete"),
          destructive: true,
        }))
      )
        return;
      setBusy(true);
      try {
        if (remove) await client.deleteShareLink(share.id);
        else await client.revokeShareLink(share.id);
        refresh();
      } catch (error) {
        toast.error(String(error));
      } finally {
        setBusy(false);
      }
    },
    [busy, client, share.id, refresh, toast, t],
  );
  const revoke = useCallback(() => {
    void run(false);
  }, [run]);
  const remove = useCallback(() => {
    void run(true);
  }, [run]);
  return (
    <View style={styles.shareRow}>
      <Text style={styles.author}>{share.title}</Text>
      <Text style={styles.muted}>
        {t("sharing.shareMetadata", {
          views: share.viewCount,
          expiry: share.expiresAt
            ? new Date(share.expiresAt).toLocaleString()
            : t("sharing.expiry.never"),
          lastViewed: share.lastViewedAt
            ? new Date(share.lastViewedAt).toLocaleString()
            : t("sharing.notViewed"),
        })}
      </Text>
      <View style={styles.actions}>
        <Button variant="ghost" size="sm" disabled>
          {t("sharing.copy")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || share.revokedAt !== null}
          onPress={revoke}
        >
          {t(share.revokedAt ? "sharing.revoked" : "sharing.revoke")}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onPress={remove}>
          {t("sharing.delete")}
        </Button>
      </View>
      <Text style={styles.muted}>{t("sharing.createNew")}</Text>
    </View>
  );
}
export function ManageShares({
  client,
  shares,
  refresh,
}: {
  client: DaemonClient;
  shares: ShareRecordPayload[];
  refresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{t("sharing.manage")}</Text>
      {shares.length === 0 ? (
        <Text style={styles.muted}>{t("sharing.empty")}</Text>
      ) : (
        shares.map((share) => (
          <ShareRecordRow key={share.id} client={client} share={share} refresh={refresh} />
        ))
      )}
    </View>
  );
}
function ShareToggle({
  model,
  field,
  group,
  value,
  disabled,
}: {
  model: ShareFormModel;
  field: "toolCalls" | "reasoning" | "errors" | "secrets" | "paths" | "contacts";
  group: "include" | "scrub";
  value: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const change = useCallback(
    (next: boolean) => {
      if (
        group === "include" &&
        (field === "toolCalls" || field === "reasoning" || field === "errors")
      )
        model.setInclude(field, next);
      if (group === "scrub" && (field === "secrets" || field === "paths" || field === "contacts"))
        model.setScrub(field, next);
    },
    [group, field, model],
  );
  return (
    <SettingsSwitch
      label={t(`sharing.fields.${field}`)}
      value={value}
      onValueChange={change}
      disabled={disabled}
    />
  );
}
const SNAP_POINTS = ["90%"];
export function ShareSheet({
  client,
  agentId,
  shares,
  onClose,
  refresh,
}: {
  client: DaemonClient;
  agentId: string;
  shares: ShareRecordPayload[];
  onClose: () => void;
  refresh: () => void;
}) {
  const model = useShareForm(client, agentId);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const { t } = useTranslation();
  const toast = useToast();
  const compact = useIsCompactFormFactor();
  const size = compact ? "md" : "sm";
  const copy = useCallback(
    async (url: string) => {
      try {
        await Clipboard.setStringAsync(url);
        toast.copied(t("sharing.copied"));
      } catch (error) {
        toast.error(String(error));
      }
    },
    [toast, t],
  );
  const create = useCallback(async () => {
    const url = await model.create();
    if (!url) return;
    refresh();
    if (isNative) {
      try {
        await Share.share({ message: url, url });
      } catch (error) {
        toast.error(String(error));
      }
    } else await copy(url);
  }, [model, refresh, toast, copy]);
  const createLink = useCallback(() => {
    void create();
  }, [create]);
  const copyLink = useCallback(() => {
    if (state.url) void copy(state.url);
  }, [copy, state.url]);
  const expiryOptions = useMemo(
    () =>
      (["never", "24h", "7d", "30d"] as const).map((value) => ({
        id: value,
        value,
        label: t(`sharing.expiry.${value}`),
      })),
    [t],
  );
  const header = useMemo(
    () => ({ title: t("sharing.title"), subtitle: t("sharing.snapshot") }),
    [t],
  );
  const selectedDisplay = useMemo(
    () => ({ label: t(`sharing.expiry.${state.expiry}`) }),
    [t, state.expiry],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          size={size}
          disabled={state.preview.status !== "loaded" || state.creating}
          onPress={createLink}
        >
          {t(state.creating ? "sharing.creating" : "sharing.create")}
        </Button>
      </View>
    ),
    [size, state.preview.status, state.creating, createLink, t],
  );
  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={header}
      desktopMaxWidth={680}
      snapPoints={SNAP_POINTS}
      testID="conversation-share-sheet"
      footer={footer}
    >
      <View style={styles.content} testID="conversation-share-content">
        {state.preview.status === "loaded" ? (
          <SharePreview snapshot={state.preview.snapshot} />
        ) : (
          <View style={styles.preview}>
            <Text style={styles.muted}>
              {state.preview.status === "loading" ? t("sharing.loading") : state.preview.message}
            </Text>
          </View>
        )}
        {state.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {state.error}
          </Text>
        ) : null}
        {state.url ? (
          <View style={styles.section}>
            <Text selectable style={styles.text}>
              {state.url}
            </Text>
            <Button variant="outline" size={size} onPress={copyLink}>
              {t("sharing.copy")}
            </Button>
          </View>
        ) : null}
        <View style={compact ? styles.optionStack : styles.optionColumns}>
          <View style={compact ? styles.section : styles.optionGroup}>
            <Text style={styles.heading}>{t("sharing.include")}</Text>
            <SettingsCard>
              {(["toolCalls", "reasoning", "errors"] as const).map((key) => (
                <ShareToggle
                  key={key}
                  model={model}
                  field={key}
                  group="include"
                  value={state.profile.include[key]}
                  disabled={state.creating}
                />
              ))}
            </SettingsCard>
          </View>
          <View style={compact ? styles.section : styles.optionGroup}>
            <Text style={styles.heading}>{t("sharing.hide")}</Text>
            <SettingsCard>
              {(["secrets", "paths", "contacts"] as const).map((key) => (
                <ShareToggle
                  key={key}
                  model={model}
                  field={key}
                  group="scrub"
                  value={state.profile.scrub[key]}
                  disabled={state.creating}
                />
              ))}
            </SettingsCard>
          </View>
        </View>
        <SelectField
          label={t("sharing.expires")}
          value={state.expiry}
          selectedDisplay={selectedDisplay}
          options={expiryOptions}
          onChange={model.setExpiry}
          placeholder={t("sharing.expires")}
          emptyText=""
          searchable={false}
          size={size}
          disabled={state.creating}
        />
        <ManageShares client={client} shares={shares} refresh={refresh} />
      </View>
    </AdaptiveModalSheet>
  );
}
const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[6], paddingVertical: theme.spacing[4] },
  preview: {
    height: 320,
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
  },
  previewScroll: { flex: 1, minHeight: 0 },
  message: { gap: theme.spacing[1], paddingVertical: theme.spacing[3] },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base, lineHeight: 22 },
  author: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, lineHeight: 20 },
  omitted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
  },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  section: { gap: theme.spacing[3] },
  optionColumns: { flexDirection: "row", gap: theme.spacing[4] },
  optionStack: { gap: theme.spacing[6] },
  optionGroup: { flex: 1, gap: theme.spacing[3] },
  shareRow: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  footer: { padding: theme.spacing[4] },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
