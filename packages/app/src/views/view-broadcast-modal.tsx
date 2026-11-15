import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { planBroadcastForCurrentState, runBroadcast } from "@/views/broadcast";
import type { BroadcastTarget } from "@/views/broadcast-plan";

/** Sends one prompt to every agent in a View (iTerm's "broadcast input"). */
export function ViewBroadcastModal({
  visible,
  targets,
  onClose,
}: {
  visible: boolean;
  targets: BroadcastTarget[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const plan = useMemo(
    () => (visible ? planBroadcastForCurrentState(targets) : []),
    [targets, visible],
  );
  const counts = useMemo(
    () => ({
      send: plan.filter((entry) => entry.delivery === "send").length,
      queue: plan.filter((entry) => entry.delivery === "queue").length,
      skip: plan.filter((entry) => entry.delivery === "skip").length,
    }),
    [plan],
  );
  const header = useMemo(() => ({ title: t("views.broadcast.title") }), [t]);

  const close = useCallback(() => {
    if (isSending) return;
    setText("");
    onClose();
  }, [isSending, onClose]);

  const send = useCallback(async () => {
    if (isSending || !text.trim()) return;
    setIsSending(true);
    try {
      // Re-plan at send time: agents may have started or finished a turn meanwhile.
      const result = await runBroadcast(text, planBroadcastForCurrentState(targets));
      let variant: "error" | "info" | "success" = "success";
      if (result.pending > 0) variant = "info";
      if (result.failed > 0) variant = "error";
      toast.show(
        t("views.broadcast.result", {
          sent: result.sent,
          queued: result.queued,
          pending: result.pending,
          skipped: result.skipped,
          failed: result.failed,
        }),
        { variant },
      );
      setText("");
      onClose();
    } finally {
      setIsSending(false);
    }
  }, [isSending, onClose, t, targets, text, toast]);
  const sendVoid = useCallback(() => {
    void send();
  }, [send]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={close}
      header={header}
      testID="view-broadcast-modal"
    >
      <View style={styles.body}>
        <Text style={styles.summary}>
          {t("views.broadcast.summary", {
            send: counts.send,
            queue: counts.queue,
            skip: counts.skip,
          })}
        </Text>
        <AdaptiveTextInput
          initialValue=""
          onChangeText={setText}
          placeholder={t("views.broadcast.placeholder")}
          multiline
          autoFocus
          editable={!isSending}
          style={styles.input}
          testID="view-broadcast-input"
        />
        <View style={styles.actions}>
          <Button variant="secondary" size="sm" onPress={close} disabled={isSending}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={sendVoid}
            loading={isSending}
            disabled={!text.trim() || counts.send + counts.queue === 0}
            testID="view-broadcast-send"
          >
            {t("views.broadcast.send")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  summary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  input: {
    minHeight: 96,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
