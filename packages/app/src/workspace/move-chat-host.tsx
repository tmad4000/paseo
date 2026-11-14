import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore, collectAllTabs } from "@/stores/workspace-layout-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { closeMoveChat, useMoveChatStore, type MoveChatRequest } from "./move-chat";

export function MoveChatHost() {
  const request = useMoveChatStore((state) => state.request);
  return request ? <MoveChatDialog key={request.newWorkspaceId} request={request} /> : null;
}

function MoveChatDialog({ request }: { request: MoveChatRequest }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [destination, setDestination] = useState("asides");
  const [title, setTitle] = useState(request.title);
  const [pickerOpen, setPickerOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const workspaces = useSessionStore((state) => state.sessions[request.serverId]?.workspaces);
  const options = useMemo(
    () => [
      {
        id: "asides",
        label: t("workspace.moveChat.asides"),
        description: t("workspace.moveChat.asidesDescription"),
      },
      { id: "new", label: t("workspace.moveChat.newWorkspace") },
      ...Array.from(workspaces?.values() ?? [])
        .filter((workspace) => workspace.id !== request.sourceWorkspaceId)
        .map((workspace) => ({
          id: workspace.id,
          label: workspace.name,
          description: workspace.projectDisplayName,
        })),
    ],
    [workspaces, request.sourceWorkspaceId, t],
  );
  const destinationLabel =
    options.find((option) => option.id === destination)?.label ?? destination;
  const mutation = useMutation({
    mutationFn: async () => {
      const client = useSessionStore.getState().sessions[request.serverId]?.client;
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      let target: Parameters<typeof client.moveAgentToWorkspace>[0]["destination"] = {
        kind: "asides",
      };
      if (destination === "new")
        target = { kind: "new", workspaceId: request.newWorkspaceId, title: title.trim() };
      else if (destination !== "asides") target = { kind: "existing", workspaceId: destination };
      return client.moveAgentToWorkspace({
        agentId: request.agentId,
        expectedWorkspaceId: request.sourceWorkspaceId,
        destination: target,
      });
    },
    onSuccess: (result) => {
      if (!result.workspace) return;
      const workspace = normalizeWorkspaceDescriptor(result.workspace);
      const runtime = getHostRuntimeStore();
      runtime.acceptWorkspaceSnapshots(request.serverId, [workspace]);
      if (result.agent)
        runtime.acceptAgentSnapshot(
          request.serverId,
          normalizeAgentSnapshot(result.agent, request.serverId),
        );
      const layout = useWorkspaceLayoutStore.getState();
      const sourceKey = `${request.serverId}:${request.sourceWorkspaceId}`;
      const source = layout.layoutByWorkspace[sourceKey];
      if (source && workspace.id !== request.sourceWorkspaceId) {
        for (const tab of collectAllTabs(source.root)) {
          if (tab.target.kind === "agent" && tab.target.agentId === request.agentId)
            layout.closeTab(sourceKey, tab.tabId);
        }
      }
      const open = () =>
        navigateToWorkspace({
          serverId: request.serverId,
          workspaceId: workspace.id,
          target: { kind: "agent", agentId: request.agentId },
        });
      closeMoveChat();
      toast.show(t("workspace.moveChat.moved", { workspace: workspace.name }), {
        variant: "success",
        action: { label: t("workspace.moveChat.open"), onPress: open },
      });
    },
  });
  const header = useMemo(
    () => ({ title: t("workspace.moveChat.title"), subtitle: request.title }),
    [request.title, t],
  );
  const close = useCallback(() => {
    if (!mutation.isPending) closeMoveChat();
  }, [mutation.isPending]);
  const submit = useCallback(() => {
    if (!mutation.isPending) mutation.mutate();
  }, [mutation]);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  return (
    <AdaptiveModalSheet visible onClose={close} header={header} testID="move-chat-dialog">
      <View style={styles.body}>
        <Text style={styles.label}>{t("workspace.moveChat.destination")}</Text>
        <View ref={anchorRef} collapsable={false}>
          <Button
            variant="outline"
            onPress={openPicker}
            disabled={mutation.isPending}
            testID="move-chat-destination"
          >
            {destinationLabel}
          </Button>
        </View>
        <Combobox
          anchorRef={anchorRef}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          value={destination}
          options={options}
          onSelect={setDestination}
          title={t("workspace.moveChat.destination")}
          searchable
        />
        {destination === "new" ? (
          <AdaptiveTextInput
            initialValue={title}
            onChangeText={setTitle}
            placeholder={t("workspace.moveChat.name")}
            maxLength={200}
            editable={!mutation.isPending}
            autoFocus
            onSubmitEditing={submit}
            style={styles.input}
            testID="move-chat-name"
          />
        ) : null}
        <Text style={styles.note}>{t("workspace.moveChat.preserved")}</Text>
        <Text style={styles.path} numberOfLines={2}>
          {request.cwd}
        </Text>
        {mutation.error ? (
          <Text accessibilityRole="alert" style={styles.error} testID="move-chat-error">
            {mutation.error.message}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button variant="secondary" onPress={close} disabled={mutation.isPending}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            onPress={submit}
            disabled={mutation.isPending || (destination === "new" && !title.trim())}
            loading={mutation.isPending}
            testID="move-chat-submit"
          >
            {mutation.isPending ? t("workspace.moveChat.moving") : t("workspace.moveChat.move")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3], paddingBottom: theme.spacing[2] },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  note: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  path: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
  },
  input: {
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
}));
