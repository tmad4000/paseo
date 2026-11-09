import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import type { ToastApi } from "@/components/toast-host";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getProviderLimitNotice } from "@/hooks/provider-limit";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useForkAgent } from "@/hooks/use-fork-agent";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { usePaneContext } from "@/panels/pane-context";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";

export function AgentLimitHandoff({
  serverId,
  workspaceId,
  agentId,
  agent,
  entries,
  toast,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  agent: AgentScreenAgent;
  entries: readonly CompanionEntry[];
  toast: ToastApi;
}) {
  const { t } = useTranslation();
  const notice = getProviderLimitNotice({ ...agent, entries });
  const connected = useHostRuntimeIsConnected(serverId);
  const supportsFork = useHostFeature(serverId, "agentForkContext");
  const snapshot = useProvidersSnapshot(serverId, { enabled: Boolean(notice), cwd: agent.cwd });
  const canPrepare = supportsFork && snapshot.supportsSnapshot;
  const fork = useForkAgent({ serverId, toast });
  const { layoutWorkspaceId } = usePaneContext();
  const [selection, setSelection] = useState<{ provider: AgentProvider; modelId: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const providers = useMemo(
    () =>
      buildSelectableProviderSelectorProviders(snapshot.entries).filter(
        (provider) => provider.id !== agent.provider,
      ),
    [snapshot.entries, agent.provider],
  );
  const validSelection =
    selection &&
    providers.some(
      (provider) =>
        provider.id === selection.provider &&
        provider.modelSelection.kind === "models" &&
        provider.modelSelection.rows.some((row) => row.modelId === selection.modelId),
    );
  const prepareHandoff = useStableEvent(async () => {
    if (!selection || !validSelection || !connected || pendingRef.current || !canPrepare) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await fork({
        agentId,
        agent,
        workspaceId,
        layoutWorkspaceId,
        target: "split",
        handoff: selection,
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  });
  const selectModel = useStableEvent((provider: AgentProvider, modelId: string) =>
    setSelection({ provider, modelId }),
  );
  const openModels = useStableEvent(() => snapshot.refetchIfStale());
  if (!notice) return null;

  return (
    <View style={styles.rail} testID="agent-limit-handoff">
      <View style={styles.content}>
        <Alert
          title={t("agentPanel.limitHandoff.title")}
          description={notice.message}
          variant="warning"
        >
          <View style={styles.body}>
            <Text style={styles.description}>{t("agentPanel.limitHandoff.description")}</Text>
            {!canPrepare ? (
              <Text style={styles.description}>{t("message.actions.forkUnavailable")}</Text>
            ) : (
              <View style={styles.controls}>
                <CombinedModelSelector
                  providers={providers}
                  selectedProvider={selection?.provider ?? ""}
                  selectedModel={selection?.modelId ?? ""}
                  onSelect={selectModel}
                  isLoading={snapshot.isLoading}
                  disabled={!connected || pending}
                  serverId={serverId}
                  onOpen={openModels}
                />
                <Button
                  onPress={prepareHandoff}
                  disabled={!connected || pending || !validSelection}
                  testID="agent-limit-handoff-prepare"
                >
                  {t(
                    pending
                      ? "agentPanel.limitHandoff.preparing"
                      : "agentPanel.limitHandoff.prepare",
                  )}
                </Button>
              </View>
            )}
            {snapshot.error ? <Text style={styles.description}>{snapshot.error}</Text> : null}
            {!snapshot.isLoading && providers.length === 0 && canPrepare ? (
              <Text style={styles.description}>{t("agentPanel.limitHandoff.noAlternatives")}</Text>
            ) : null}
          </View>
        </Alert>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: { padding: theme.spacing[4], alignItems: "center" },
  content: { width: "100%", maxWidth: MAX_CONTENT_WIDTH },
  body: { flex: 1, minWidth: 0, gap: theme.spacing[2] },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
}));
