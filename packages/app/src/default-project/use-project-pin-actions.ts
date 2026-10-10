import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { selectHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import type { HostProjectRef } from "./model";

export interface ProjectPinActions {
  /** Pins or unpins the project on each host that supports project pinning. */
  setPinned: (hosts: readonly HostProjectRef[], pinned: boolean) => void;
  /** Makes the project the Default project, or removes it as default, on each supporting host. */
  setDefault: (hosts: readonly HostProjectRef[], isDefault: boolean) => void;
}

// Module scope so the sidebar menu, the context menu, the command center and settings share one
// guard: two surfaces must not fire opposite writes for the same project at the same time.
const pendingKeys = new Set<string>();

function pendingKey(kind: "pin" | "default", hosts: readonly HostProjectRef[]): string {
  return `${kind}:${hosts.map((host) => `${host.serverId}:${host.projectId}`).join("|")}`;
}

export function supportedProjectPinHosts(hosts: readonly HostProjectRef[]): HostProjectRef[] {
  const state = useSessionStore.getState();
  return hosts.filter((host) => selectHostFeature(state, host.serverId, "projectPinning"));
}

export function useProjectPinActions(): ProjectPinActions {
  const { t } = useTranslation();
  const toast = useToast();

  const run = useCallback(
    (
      kind: "pin" | "default",
      hosts: readonly HostProjectRef[],
      write: (host: HostProjectRef) => Promise<unknown>,
    ) => {
      const targets = supportedProjectPinHosts(hosts);
      if (targets.length === 0) return;
      const key = pendingKey(kind, targets);
      if (pendingKeys.has(key)) return;
      pendingKeys.add(key);
      // Settles every host before reporting, so one offline host does not hide the others' result.
      const settle = async () => {
        try {
          const results = await Promise.allSettled(targets.map(write));
          const failure = results.find((result) => result.status === "rejected");
          if (!failure) return;
          const reason: unknown = failure.reason;
          toast.error(reason instanceof Error ? reason.message : t("defaultProject.toasts.failed"));
        } finally {
          pendingKeys.delete(key);
        }
      };
      void settle();
    },
    [t, toast],
  );

  const setPinned = useCallback(
    (hosts: readonly HostProjectRef[], pinned: boolean) => {
      run("pin", hosts, async (host) => {
        const client = getHostRuntimeStore().getClient(host.serverId);
        if (!client) throw new Error(t("defaultProject.toasts.hostDisconnected"));
        await client.setProjectPinned(host.projectId, pinned);
      });
    },
    [run, t],
  );

  const setDefault = useCallback(
    (hosts: readonly HostProjectRef[], isDefault: boolean) => {
      run("default", hosts, async (host) => {
        const client = getHostRuntimeStore().getClient(host.serverId);
        if (!client) throw new Error(t("defaultProject.toasts.hostDisconnected"));
        await client.setProjectDefault(host.projectId, isDefault);
      });
    },
    [run, t],
  );

  return useMemo(() => ({ setPinned, setDefault }), [setDefault, setPinned]);
}
