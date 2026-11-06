import {
  buildAgentDeepLinkRoute,
  parseAgentDeepLink,
  type AgentDeepLinkTarget,
} from "./agent-deep-link.js";

export interface WorkspaceDeepLinkTarget {
  serverId: string;
  workspaceId: string;
  open?: string;
}

export type AppDeepLinkTarget = AgentDeepLinkTarget | WorkspaceDeepLinkTarget;

export function buildAppDeepLinkRoute(target: AppDeepLinkTarget): string {
  if ("agentId" in target) return buildAgentDeepLinkRoute(target);
  const route = `/h/${encodeURIComponent(target.serverId)}/workspace/${encodeURIComponent(target.workspaceId)}`;
  return target.open ? `${route}?open=${encodeURIComponent(target.open)}` : route;
}

/** Only navigation targets are accepted; links never carry credentials or commands. */
export function parseAppDeepLink(input: string): AppDeepLinkTarget | null {
  const agent = parseAgentDeepLink(input);
  if (agent) return agent;
  try {
    const url = new URL(input);
    if (
      !["paseo-fork:", "paseo:"].includes(url.protocol) ||
      url.hostname !== "h" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return null;
    const segments = url.pathname.split("/");
    if (segments.length !== 4 || segments[2] !== "workspace") return null;
    const serverId = decodeURIComponent(segments[1]!).trim();
    const workspaceId = decodeURIComponent(segments[3]!).trim();
    if (!serverId || !workspaceId) return null;
    if ([...url.searchParams.keys()].some((key) => key !== "open")) return null;
    const opens = url.searchParams.getAll("open");
    if (
      opens.length > 1 ||
      opens.some((open) => !/^(agent|terminal|file|draft|setup):.+$/.test(open))
    )
      return null;
    return { serverId, workspaceId, ...(opens[0] ? { open: opens[0] } : {}) };
  } catch {
    return null;
  }
}
