import { parseAgentDeepLink, type AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";

export type SessionLinkDisposition = "current" | "side" | "window";
export type SessionLinkFailure =
  | "invalid"
  | "unknownHost"
  | "unavailable"
  | "notFound"
  | "sideUnavailable"
  | "windowUnavailable";

export class SessionLinkError extends Error {
  constructor(readonly reason: SessionLinkFailure) {
    super(reason);
    this.name = "SessionLinkError";
  }
}

// Keep custom session URLs out of the generic external opener, including malformed ones.
export function isSessionLink(href: string): boolean {
  return /^paseo(?:-fork)?:/i.test(href);
}

export interface SessionLinkPorts {
  isKnownHost(serverId: string): boolean;
  resolveAgent(
    target: AgentDeepLinkTarget,
  ): Promise<{ id: string; workspaceId: string | null } | null>;
  navigate(
    target: AgentDeepLinkTarget & { workspaceId: string },
    disposition: "current" | "side",
  ): void;
  openWindow?: (target: AgentDeepLinkTarget) => Promise<unknown>;
}

export async function openSessionLinkWithPorts(
  href: string,
  disposition: SessionLinkDisposition,
  ports: SessionLinkPorts,
): Promise<void> {
  const target = parseAgentDeepLink(href);
  if (!target) throw new SessionLinkError("invalid");
  if (!ports.isKnownHost(target.serverId)) throw new SessionLinkError("unknownHost");
  if (disposition === "window" && !ports.openWindow)
    throw new SessionLinkError("windowUnavailable");
  const agent = await ports.resolveAgent(target);
  // A removed host or a mismatched lookup must never navigate to an unverified target.
  if (!ports.isKnownHost(target.serverId)) throw new SessionLinkError("unknownHost");
  if (!agent || agent.id !== target.agentId || !agent.workspaceId)
    throw new SessionLinkError("notFound");
  if (disposition === "window") {
    await ports.openWindow!(target);
  } else {
    ports.navigate({ ...target, workspaceId: agent.workspaceId }, disposition);
  }
}

// Native text selection owns the long press. Include each session URL in the message menu
// so link actions remain available without replacing UIKit selection or inserting block views.
export function sessionLinksInMessage(content: string): string[] {
  return [...new Set(content.match(/paseo(?:-fork)?:\/\/[^\s<>"')\]]+/gi) ?? [])].filter(
    (href) => parseAgentDeepLink(href) !== null,
  );
}
