import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import { ArtifactCard } from "@/artifacts/feed";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { ArtifactPinOperations } from "./artifact-pin-operations";
import type { GlobalStreamRow } from "./use-global-stream";
import type { WorkflowLocalContext } from "./global-screen";

/** Own-chat file cards keep preview, side-open and pin behavior; foreign files open their source. */
export function WorkflowArtifact({
  artifact,
  row,
  localContext,
  onOpenChat,
  onSaved,
}: {
  artifact: AgentArtifact;
  row: GlobalStreamRow;
  localContext?: WorkflowLocalContext;
  onOpenChat: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const ownSource = localContext?.serverId === row.serverId && localContext.agentId === row.agentId;
  const client = useHostRuntimeClient(row.serverId);
  const connection = useHostRuntimeConnectionStatus(row.serverId);
  const supportsWrites = useSessionStore(
    (state) => state.sessions[row.serverId]?.serverInfo?.features?.globalStream === true,
  );
  const pins = useRef(new ArtifactPinOperations());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openFile = useCallback(
    (file: AgentArtifact) => {
      if (!ownSource || !localContext) return;
      localContext.onOpenWorkspaceFile?.({ location: { path: file.path }, disposition: "side" });
      localContext.onReturnToChat();
    },
    [ownSource, localContext],
  );
  const pin = useCallback(() => {
    if (!client || connection !== "online" || !supportsWrites || busy) return;
    setBusy(true);
    setError(null);
    void pins.current
      .save(row.serverId, row.agentId, artifact.path, (input) => client.updateStreamEntry(input))
      .then(onSaved)
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : t("globalStream.saveFailed")),
      )
      .finally(() => setBusy(false));
  }, [
    client,
    connection,
    supportsWrites,
    busy,
    row.serverId,
    row.agentId,
    artifact.path,
    onSaved,
    t,
  ]);
  if (!localContext || !ownSource)
    return (
      <View style={styles.artifact}>
        <Text style={styles.description}>{t("globalStream.artifact")}</Text>
        <Text selectable style={styles.path}>
          {artifact.path}
        </Text>
        <Button variant="outline" onPress={onOpenChat}>
          {t("globalStream.openChat")}
        </Button>
      </View>
    );
  if (!localContext.artifactsSupported)
    return (
      <View style={styles.artifact}>
        <Text style={styles.description}>{t("agentPanel.artifacts.updateHostDescription")}</Text>
      </View>
    );
  const canPin = supportsWrites && connection === "online" && !busy;
  return (
    <View>
      <ArtifactCard
        artifact={artifact}
        serverId={row.serverId}
        cwd={localContext.cwd}
        onOpen={openFile}
        onPin={canPin ? pin : undefined}
      />
      {busy ? <Text style={styles.description}>{t("globalStream.saving")}</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  artifact: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
  },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  path: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.statusWarning, fontSize: theme.fontSize.sm },
}));
