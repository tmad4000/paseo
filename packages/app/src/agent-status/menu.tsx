import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { MenuHint, MenuItem, MenuSubTrigger, type MenuPageDefinition } from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { useHostFeatureAvailability } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  loadStatusTargets,
  MANUAL_STATUSES,
  manualStatus,
  manualStatusPatch,
  type ManualStatus,
  type ManualStatusTarget,
} from "./model";

const STATUS_PAGE = "manualAgentStatus";

export function AgentStatusMenuTrigger() {
  const { t } = useTranslation();
  return (
    <MenuSubTrigger id={STATUS_PAGE} testID="manual-status-menu">
      {t("manualStatus.title")}
    </MenuSubTrigger>
  );
}

export function useAgentStatusMenuPages(
  target: ManualStatusTarget | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  return useMemo(
    () =>
      target
        ? [
            {
              id: STATUS_PAGE,
              title: t("manualStatus.title"),
              content: <AgentStatusPage target={target} />,
            },
          ]
        : [],
    [t, target],
  );
}

type TargetState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; agents: AgentSnapshotPayload[] };

function AgentStatusPage({ target }: { target: ManualStatusTarget }) {
  const { t } = useTranslation();
  const toast = useToast();
  const supported = useHostFeatureAvailability(target.serverId, "manualAgentStatus");
  const [state, setState] = useState<TargetState>({ kind: "loading" });
  const [pending, setPending] = useState<ManualStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    setState({ kind: "loading" });
    const client = getHostRuntimeStore().getClient(target.serverId);
    if (!client) {
      setState({ kind: "error", message: t("workspace.terminal.hostDisconnected") });
      return;
    }
    void loadStatusTargets(client, target).then(
      (agents) => {
        if (!cancelled) setState({ kind: "ready", agents });
        return undefined;
      },
      (error: unknown) => {
        if (!cancelled)
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : t("manualStatus.failed"),
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [target, supported, attempt, t]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const selectStatus = useCallback(
    async (status: ManualStatus) => {
      if (state.kind !== "ready" || pending !== null) return;
      const client = getHostRuntimeStore().getClient(target.serverId);
      if (!client) {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return;
      }
      setPending(status);
      const results = await Promise.allSettled(
        state.agents.map((agent) =>
          client.updateAgent(agent.id, { labels: manualStatusPatch(status) }),
        ),
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0)
        toast.error(t("manualStatus.partialFailure", { failed, total: results.length }));
      else toast.show(t("manualStatus.saved"));
      setPending(null);
      setAttempt((value) => value + 1);
    },
    [state, pending, target.serverId, t, toast],
  );

  if (supported === false) return <MenuHint>{t("manualStatus.updateHost")}</MenuHint>;
  if (state.kind === "error")
    return (
      <>
        <MenuHint>{state.message}</MenuHint>
        <MenuItem closeOnSelect={false} onSelect={retry}>
          {t("manualStatus.retry")}
        </MenuItem>
      </>
    );
  if (state.kind === "loading") return <MenuHint>{t("common.states.loading")}</MenuHint>;
  if (state.agents.length === 0) return <MenuHint>{t("manualStatus.empty")}</MenuHint>;
  return (
    <>
      <MenuHint>
        {target.kind === "workspace"
          ? t("manualStatus.workspaceScope", { count: state.agents.length })
          : t("manualStatus.sessionScope")}
      </MenuHint>
      {MANUAL_STATUSES.map((status) => (
        <StatusOption
          key={status}
          value={status}
          selected={state.agents.every((agent) => manualStatus(agent.labels) === status)}
          pending={pending}
          onSelect={selectStatus}
        />
      ))}
    </>
  );
}

function StatusOption({
  value,
  selected,
  pending,
  onSelect,
}: {
  value: ManualStatus;
  selected: boolean;
  pending: ManualStatus | null;
  onSelect: (status: ManualStatus) => Promise<void>;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => {
    void onSelect(value);
  }, [onSelect, value]);
  return (
    <MenuItem
      testID={`manual-status-${value}`}
      selected={selected}
      showSelectedCheck
      disabled={pending !== null}
      status={pending === value ? "pending" : "idle"}
      closeOnSelect={false}
      onSelect={select}
    >
      {t(`manualStatus.${value}`)}
    </MenuItem>
  );
}
