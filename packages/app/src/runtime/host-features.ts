import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import type { DaemonServerInfo } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";

export type HostFeatureName = keyof NonNullable<DaemonServerInfo["features"]>;

export interface HostFeatureSessionState {
  sessions: Record<
    string,
    | {
        serverInfo: DaemonServerInfo | null;
      }
    | undefined
  >;
}

export function hostSupportsFeature(
  serverInfo: DaemonServerInfo | null | undefined,
  feature: HostFeatureName,
): boolean {
  return serverInfo?.features?.[feature] === true;
}

/**
 * True or false once the host's server info has arrived; null while it is unknown. A host that
 * has not connected yet is not an older host, so gates on existing surfaces must not read null as
 * "update the host".
 */
export function hostFeatureAvailability(
  serverInfo: DaemonServerInfo | null | undefined,
  feature: HostFeatureName,
): boolean | null {
  return serverInfo ? hostSupportsFeature(serverInfo, feature) : null;
}

/** True only once every host has reported in without the feature; unknown hosts never count. */
export function everyHostLacksFeature(availability: ReadonlyMap<string, boolean | null>): boolean {
  const hosts = [...availability.values()];
  return hosts.length > 0 && hosts.every((supported) => supported === false);
}

export function selectHostFeature(
  state: HostFeatureSessionState,
  serverId: string,
  feature: HostFeatureName,
): boolean {
  return hostSupportsFeature(state.sessions[serverId]?.serverInfo, feature);
}

export function useHostFeature(
  serverId: string | null | undefined,
  feature: HostFeatureName,
): boolean {
  const normalizedServerId = serverId?.trim() ?? "";
  return useSessionStore((state) => selectHostFeature(state, normalizedServerId, feature));
}

export function useHostFeatureAvailability(
  serverId: string | null | undefined,
  feature: HostFeatureName,
): boolean | null {
  const normalizedServerId = serverId?.trim() ?? "";
  return useSessionStore((state) =>
    hostFeatureAvailability(state.sessions[normalizedServerId]?.serverInfo, feature),
  );
}

export function useHostFeatureMap(
  serverIds: readonly string[],
  feature: HostFeatureName,
): ReadonlyMap<string, boolean> {
  const flags = useSessionStore(
    useShallow((state) => serverIds.map((serverId) => selectHostFeature(state, serverId, feature))),
  );

  return useMemo(
    () => new Map(serverIds.map((serverId, index) => [serverId, flags[index] === true] as const)),
    [flags, serverIds],
  );
}

export function useHostFeatureAvailabilityMap(
  serverIds: readonly string[],
  feature: HostFeatureName,
): ReadonlyMap<string, boolean | null> {
  const flags = useSessionStore(
    useShallow((state) =>
      serverIds.map((serverId) =>
        hostFeatureAvailability(state.sessions[serverId]?.serverInfo, feature),
      ),
    ),
  );

  return useMemo(
    () => new Map(serverIds.map((serverId, index) => [serverId, flags[index]] as const)),
    [flags, serverIds],
  );
}
