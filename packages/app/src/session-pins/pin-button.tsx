import { useCallback, useMemo, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pin, PinOff } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Alert } from "@/components/ui/alert";
import { View, StyleSheet } from "react-native";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { sessionPinnedAt, setSessionPinned } from "./model";

export function SessionPinButton({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const pending = useRef(false);
  const agent = useSessionStore(
    (state) =>
      state.sessions[serverId]?.agents.get(agentId) ??
      state.sessions[serverId]?.agentDetails.get(agentId),
  );
  const pinned = agent ? sessionPinnedAt(agent) !== null : false;
  const mutation = useMutation({
    mutationFn: async () => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client || !agent) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      await setSessionPinned(agent, !pinned, (id, updates) => client.updateAgent(id, updates));
    },
    onSettled: () => {
      pending.current = false;
    },
  });
  const mutate = mutation.mutate;
  const handlePress = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    mutate();
  }, [mutate]);
  const accessibilityState = useMemo(() => ({ selected: pinned }), [pinned]);
  if (!agent || agent.archivedAt) return null;
  const label = pinned
    ? t("sessionPins.unpin", "Unpin session")
    : t("sessionPins.pin", "Pin session");
  return (
    <View style={styles.container}>
      <Button
        variant="ghost"
        style={compact ? styles.compactButton : undefined}
        size={compact ? "md" : "sm"}
        leftIcon={pinned ? PinOff : Pin}
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        testID="session-pin-toggle"
        loading={mutation.isPending}
        onPress={handlePress}
      >
        {label}
      </Button>
      {mutation.error ? (
        <Alert
          variant="error"
          size="sm"
          description={mutation.error.message}
          testID="session-pin-error"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { maxWidth: "100%" },
  compactButton: { minHeight: 44 },
});
