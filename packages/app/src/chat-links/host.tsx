import { memo, useCallback, useMemo, useRef, type ReactElement, type RefObject } from "react";
import * as Clipboard from "expo-clipboard";
import { browserIdForUrl, normalizeUiBrowserUrl } from "@getpaseo/protocol/ui-browser-target";
import type { AgentStreamViewHandle } from "@/agent-stream/view";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getIsElectron } from "@/constants/platform";
import { useBrowserStore } from "@/desktop/browser/store";
import { useLoadOlderAgentHistory } from "@/hooks/use-load-older-agent-history";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { openExternalUrl } from "@/utils/open-external-url";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { showWorkspaceTargetBeside } from "@/workspace-tabs/open-beside";
import { extractChatLinks, hasChatLinks, type ChatLink } from "./model";
import { ChatLinksTrack, type ChatLinkActions, type ChatLinksHistory } from "./track";

const NO_ROWS: StreamItem[] = [];

/**
 * Desktop opens the page as a browser tab in the workspace's side pane — the same target and
 * placement `ui.tab.open` uses with `placement: "side"`, applied on this client only. Browser panes
 * exist only in the desktop app, so web and native hand the URL to the system.
 */
export function openChatLinkUrl(input: {
  url: string;
  serverId: string;
  workspaceId: string | undefined;
  isCompact: boolean;
}): void {
  const url = normalizeUiBrowserUrl(input.url);
  const workspaceKey = input.workspaceId
    ? buildWorkspaceTabPersistenceKey({ serverId: input.serverId, workspaceId: input.workspaceId })
    : null;
  if (getIsElectron() && url && workspaceKey) {
    const browserId = browserIdForUrl(url);
    useBrowserStore.getState().ensureBrowser(browserId, url);
    showWorkspaceTargetBeside({
      workspaceKey,
      target: { kind: "browser", browserId },
      isCompact: input.isCompact,
    });
    return;
  }
  void openExternalUrl(input.url);
}

/**
 * Actions for the Links track and its peek. Everything reads through refs, so the object is
 * stable and memoized rows do not re-render as the agent streams.
 */
export function useChatLinkActions(input: {
  serverId: string;
  workspaceId: string | undefined;
  rows: readonly StreamItem[];
  jumpToItem: (itemId: string) => void;
}): ChatLinkActions {
  const isCompact = useIsCompactFormFactor();
  const latest = useRef({ ...input, isCompact });
  latest.current = { ...input, isCompact };
  const open = useCallback((link: ChatLink) => {
    const { serverId, workspaceId, isCompact: compact } = latest.current;
    openChatLinkUrl({ url: link.url, serverId, workspaceId, isCompact: compact });
  }, []);
  const copy = useCallback((link: ChatLink) => {
    void Clipboard.setStringAsync(link.url);
  }, []);
  const jump = useCallback((link: ChatLink) => {
    latest.current.jumpToItem(link.anchor.itemId);
  }, []);
  const canJump = useCallback(
    (link: ChatLink) => latest.current.rows.some((row) => row.id === link.anchor.itemId),
    [],
  );
  return useMemo(() => ({ open, copy, jump, canJump }), [canJump, copy, jump, open]);
}

/** Cheap enough to run on every store change: rows are scanned once and cached. */
export function useAgentHasChatLinks(serverId: string, agentId: string): boolean {
  return useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      hasChatLinks(session?.agentStreamTail?.get(agentId) ?? NO_ROWS) ||
      hasChatLinks(session?.agentStreamHead?.get(agentId) ?? NO_ROWS)
    );
  });
}

/** Links and their actions for a stream view's loaded rows; Jump goes through its handle. */
export function useStreamChatLinks(input: {
  serverId: string;
  workspaceId: string | undefined;
  tail: readonly StreamItem[] | undefined;
  head: readonly StreamItem[] | undefined;
  streamViewRef: RefObject<AgentStreamViewHandle | null>;
}): { links: ChatLink[]; actions: ChatLinkActions } {
  const { serverId, workspaceId, tail, head, streamViewRef } = input;
  const rows = useMemo(() => [...(tail ?? NO_ROWS), ...(head ?? NO_ROWS)], [head, tail]);
  const links = useMemo(() => extractChatLinks(rows), [rows]);
  const jumpToItem = useCallback(
    (itemId: string) => streamViewRef.current?.jumpToStreamItem(itemId),
    [streamViewRef],
  );
  const actions = useChatLinkActions({ serverId, workspaceId, rows, jumpToItem });
  return { links, actions };
}

/** The agent pane's Links track: links from the chat's loaded rows, jumps through the stream. */
export const AgentChatLinksTrack = memo(function AgentChatLinksTrack({
  serverId,
  workspaceId,
  agentId,
  streamViewRef,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  streamViewRef: RefObject<AgentStreamViewHandle | null>;
}): ReactElement | null {
  const tail = useSessionStore((state) => state.sessions[serverId]?.agentStreamTail?.get(agentId));
  const head = useSessionStore((state) => state.sessions[serverId]?.agentStreamHead?.get(agentId));
  const { links, actions } = useStreamChatLinks({
    serverId,
    workspaceId,
    tail,
    head,
    streamViewRef,
  });
  const { hasOlder, isLoadingOlder, loadOlder } = useLoadOlderAgentHistory({ serverId, agentId });
  const loadEarlier = useCallback(() => void loadOlder(), [loadOlder]);
  const history = useMemo<ChatLinksHistory>(
    () => ({ hasOlder, isLoadingOlder, loadOlder: loadEarlier }),
    [hasOlder, isLoadingOlder, loadEarlier],
  );
  return <ChatLinksTrack links={links} actions={actions} history={history} />;
});
