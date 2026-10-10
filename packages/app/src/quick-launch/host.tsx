import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { requestWorkspaceDraftAgent } from "@/composer/draft/create-agent-request";
import { useToast } from "@/contexts/toast-context";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { createProjectWorkspace } from "@/screens/new-workspace/create-workspace";
import { QUICK_LAUNCH_DRAFT_KEY } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { toErrorMessage } from "@/utils/error-messages";
import { focusWithRetries } from "@/utils/web-focus";
import { QuickLaunchDialog, type QuickLaunchStartRequest } from "./dialog";
import { runQuickLaunch, type QuickLaunchPorts, type QuickLaunchStarted } from "./launch";
import {
  openQuickLaunch,
  takeQuickLaunchFocusRestoreElement,
  useQuickLaunchStore,
  type QuickLaunchSession,
} from "./store";

const QUICK_LAUNCH_ACTIONS: readonly KeyboardActionId[] = ["quick-launch.open"];
const RESULT_TOAST_DURATION_MS = 6000;
const FAILURE_TOAST_DURATION_MS = 10000;

function createQuickLaunchPorts(input: {
  queryClient: QueryClient;
  hostDisconnectedMessage: string;
}): QuickLaunchPorts {
  function connectedClient(serverId: string) {
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client?.isConnected) throw new Error(input.hostDisconnectedMessage);
    return client;
  }
  return {
    createWorkspace: (request) =>
      createProjectWorkspace({
        ...request,
        client: connectedClient(request.serverId),
        queryClient: input.queryClient,
      }),
    createAgent: (serverId, request) =>
      requestWorkspaceDraftAgent(connectedClient(serverId), request),
  };
}

function openStartedAgent(started: QuickLaunchStarted) {
  navigateToWorkspace({
    serverId: started.serverId,
    workspaceId: started.workspaceId,
    target: { kind: "agent", agentId: started.agentId },
  });
}

/** A failed start puts its prompt back unless a newer draft has taken its place. */
function restoreFailedPrompt(text: string) {
  const store = useDraftStore.getState();
  if (store.getDraftInput(QUICK_LAUNCH_DRAFT_KEY)?.text) return;
  store.saveDraftInput({ draftKey: QUICK_LAUNCH_DRAFT_KEY, draft: { text, attachments: [] } });
}

/**
 * Owns Quick launch: the global shortcut, the dialog, the creation request, and its result
 * toasts. Creation runs here rather than in the dialog, so closing the dialog on Start never
 * cancels or orphans the request.
 */
export function QuickLaunchHost() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const hosts = useHosts();
  const active = useActiveWorkspaceSelection();
  const session = useQuickLaunchStore((state) => state.session);
  const close = useQuickLaunchStore((state) => state.close);

  // The dialog stays mounted through its exit animation; a new session remounts it fresh.
  const [mountedSession, setMountedSession] = useState<QuickLaunchSession | null>(session);
  if (session && session !== mountedSession) {
    setMountedSession(session);
  }
  const handleDismiss = useCallback(() => {
    if (!useQuickLaunchStore.getState().session) setMountedSession(null);
  }, []);

  const handleShortcut = useCallback(() => {
    openQuickLaunch();
    return true;
  }, []);
  useKeyboardActionHandler({
    handlerId: "quick-launch-global",
    actions: QUICK_LAUNCH_ACTIONS,
    enabled: hosts.length > 0,
    priority: 0,
    handle: handleShortcut,
  });

  const isOpen = session !== null;
  const wasOpenRef = useRef(isOpen);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (isOpen || !wasOpen) return;
    const element = takeQuickLaunchFocusRestoreElement();
    if (!element) return;
    return focusWithRetries({
      focus: () => element.focus(),
      isFocused: () => typeof document !== "undefined" && document.activeElement === element,
      onTimeout: () =>
        keyboardActionDispatcher.dispatch({ id: "message-input.focus", scope: "message-input" }),
    });
  }, [isOpen, keyboardActionDispatcher]);

  const ports = useMemo(
    () =>
      createQuickLaunchPorts({
        queryClient,
        hostDisconnectedMessage: t("newWorkspace.errors.hostDisconnected"),
      }),
    [queryClient, t],
  );

  const start = useCallback(
    (request: QuickLaunchStartRequest) => {
      close();
      const destination = request.workspaceName ?? t("quickLaunch.toast.newWorkspace");
      const names = { project: request.projectName, workspace: destination };
      toast.show(t("quickLaunch.toast.starting", names), { durationMs: null });
      void runQuickLaunch(request.submission, ports, {
        createFailed: t("quickLaunch.errors.createFailed"),
        noAgent: t("quickLaunch.errors.noAgent"),
      })
        .then((started) => {
          if (request.openAfterStart) {
            openStartedAgent(started);
            toast.show(t("quickLaunch.toast.started", names), { variant: "success" });
            return;
          }
          toast.show(
            <QuickLaunchToastContent
              message={t("quickLaunch.toast.started", names)}
              actionLabel={t("quickLaunch.toast.open")}
              onAction={() => openStartedAgent(started)}
              testID="quick-launch-toast-open"
            />,
            { variant: "success", durationMs: RESULT_TOAST_DURATION_MS },
          );
        })
        .catch((error: unknown) => {
          restoreFailedPrompt(request.submission.text);
          toast.show(
            <QuickLaunchToastContent
              message={t("quickLaunch.toast.failed", { error: toErrorMessage(error) })}
              actionLabel={t("quickLaunch.toast.retry")}
              onAction={() => openQuickLaunch(request.retry)}
              testID="quick-launch-toast-retry"
            />,
            { variant: "error", durationMs: FAILURE_TOAST_DURATION_MS },
          );
        });
    },
    [close, ports, t, toast],
  );

  if (!mountedSession) return null;
  return (
    <QuickLaunchDialog
      key={mountedSession.id}
      visible={isOpen}
      session={mountedSession}
      active={active}
      onClose={close}
      onDismiss={handleDismiss}
      onStart={start}
    />
  );
}

function QuickLaunchToastContent({
  message,
  actionLabel,
  onAction,
  testID,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  testID: string;
}) {
  return (
    <View style={styles.toastRow}>
      <Text style={styles.toastMessage}>{message}</Text>
      <Button size="xs" variant="outline" onPress={onAction} testID={testID}>
        {actionLabel}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  toastRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  toastMessage: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
