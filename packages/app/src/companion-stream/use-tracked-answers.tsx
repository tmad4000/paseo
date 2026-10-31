import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToastApi } from "@/components/toast-host";
import { useHostFeature } from "@/runtime/host-features";
import { useAgentViewStore } from "@/stores/agent-view-store";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem, TimelinePosition } from "@/types/stream";
import type { TimelineJump } from "@/agent-stream/use-timeline-anchor-jump";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { trackedQuestionEntryId } from "./answers-model";
import { splitEntryText } from "./entry-labels";
import { TrackedAnswersPane, type TrackedAnswerActions } from "./answers-pane";
import {
  chatMessageEvents,
  computeChatSessions,
  sessionsSignature,
  type ChatSessions,
} from "./answers-sessions";

type TrackQuestionHandler = (
  text: string,
  messageId?: string,
  timelineCursor?: TimelinePosition,
) => void;

const NO_ENTRIES: CompanionEntry[] = [];
const NO_ITEMS: StreamItem[] = [];

// COMPAT(streamAnswers): fork feature; remove gate after 2027-04-26.
function useSupportsTrackedAnswers(serverId: string): boolean {
  return useHostFeature(serverId, "streamAnswers");
}

// COMPAT(streamOpenAsks): fork feature; remove gate after 2027-04-29. Older hosts keep the
// questions-only pane.
function useSupportsOpenAsks(serverId: string): boolean {
  return useHostFeature(serverId, "streamOpenAsks");
}

/**
 * Track Q&A on a user message. Capable hosts get the message's timeline position, so they
 * can attach its answer; the save is acknowledged. Older hosts keep the original record.
 */
export function useTrackQuestion(
  serverId: string,
  agentId: string,
  client: DaemonClient | null,
  toast: ToastApi | null | undefined,
): TrackQuestionHandler {
  const { t } = useTranslation();
  const supported = useSupportsTrackedAnswers(serverId);
  return useCallback<TrackQuestionHandler>(
    (text, messageId, timelineCursor) => {
      if (!agentId || !client) return;
      const sourceId = messageId ? `msg:${messageId}` : undefined;
      if (!supported || !timelineCursor) {
        client
          .updateCompanionEntry({ agentId, action: "add_q_and_a", text, sourceId })
          .catch(() => {});
        return;
      }
      client
        .updateStreamEntry({
          agentId,
          action: "add_q_and_a",
          entryId: trackedQuestionEntryId(timelineCursor),
          text,
          sourceId,
          questionAnchor: {
            epoch: timelineCursor.epoch,
            startSeq: timelineCursor.seq,
            endSeq: timelineCursor.seq,
          },
        })
        .then(() => toast?.show(t("agentPanel.stream.answers.tracked")))
        .catch(() => toast?.error(t("agentPanel.stream.answers.trackFailed")));
    },
    [agentId, client, supported, t, toast],
  );
}

/**
 * Titles of the chats unresolved asks are delegated to. Selects one string, so the pane does not
 * re-render on unrelated session updates.
 */
function useOwnerTitles(serverId: string, entries: readonly CompanionEntry[]) {
  const ownerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of entries) {
      const owner = entry.ask?.state !== "done" ? entry.ask?.delegatedAgentId : undefined;
      if (owner) ids.add(owner);
    }
    return [...ids];
  }, [entries]);
  const titlesKey = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return JSON.stringify(
      ownerIds.map(
        (id) => (session?.agents.get(id) ?? session?.agentDetails.get(id))?.title ?? null,
      ),
    );
  });
  return useMemo(() => {
    const titles = JSON.parse(titlesKey) as (string | null)[];
    const byId = new Map(ownerIds.map((id, index) => [id, titles[index] ?? null]));
    return (agentId: string) => byId.get(agentId) ?? null;
  }, [ownerIds, titlesKey]);
}

/**
 * The chat's sessions from everything it has loaded: committed rows plus the turn streaming now.
 * Message events are extracted per array, so a streaming chunk only rescans the small head.
 * While older history is still unloaded, the first loaded session does not claim a start.
 */
function useChatSessions(serverId: string, agentId: string): ChatSessions {
  const tail = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamTail.get(agentId) ?? NO_ITEMS,
  );
  const head = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamHead.get(agentId) ?? NO_ITEMS,
  );
  const hasOlder = useSessionStore(
    (state) => state.sessions[serverId]?.agentTimelineHasOlder.get(agentId) ?? false,
  );
  const tailEvents = useMemo(() => chatMessageEvents(tail), [tail]);
  const headEvents = useMemo(() => chatMessageEvents(head), [head]);
  const computed = useMemo(
    () => computeChatSessions([...tailEvents, ...headEvents], { historyComplete: !hasOlder }),
    [hasOlder, headEvents, tailEvents],
  );
  // Streaming chunks rebuild the sessions without changing where anything sits; keep the
  // previous object then, so the memoized pane does not re-render on every chunk.
  const [stable, setStable] = useState(computed);
  if (stable !== computed && sessionsSignature(stable) !== sessionsSignature(computed)) {
    setStable(computed);
  }
  return sessionsSignature(stable) === sessionsSignature(computed) ? stable : computed;
}

/** The answers pane for one chat, fed by the agent's live Stream snapshot. */
export function ChatTrackedAnswers({
  serverId,
  agentId,
  client,
  readOnly,
  jump,
}: {
  serverId: string;
  agentId: string;
  client: DaemonClient | null;
  readOnly: boolean;
  jump: TimelineJump;
}) {
  const supported = useSupportsTrackedAnswers(serverId);
  const showOpenAsks = useSupportsOpenAsks(serverId);
  const openStreamEntry = useAgentViewStore((state) => state.openStreamEntry);
  const entries = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))?.companionEntries ??
      NO_ENTRIES
    );
  });
  const agentTitle = useOwnerTitles(serverId, showOpenAsks ? entries : NO_ENTRIES);
  const sessions = useChatSessions(serverId, agentId);
  // The jump callbacks change with every streamed row; reading them through a ref keeps the
  // pane's actions stable, so its memoized rows do not re-render while the agent streams.
  const jumpRef = useRef(jump);
  jumpRef.current = jump;
  const actions = useMemo<TrackedAnswerActions>(() => {
    const update = async (input: Omit<StreamEntryUpdate, "agentId">) => {
      if (!client) throw new Error("Not connected");
      await client.updateStreamEntry({ agentId, ...input });
    };
    return {
      jumpToAnchor: (anchor) => jumpRef.current.jumpToAnchor(anchor),
      jumpToMessage: (messageId) => jumpRef.current.jumpToMessage(messageId),
      hasMessage: (messageId) => jumpRef.current.hasMessage(messageId),
      openChat: (target) => navigateToAgent({ serverId, agentId: target }),
      markSeen: (entryId, replyRevision) =>
        update({ action: "mark_reply_seen", entryId, replyRevision }),
      stopTracking: (entryId) => update({ action: "update_status", entryId, status: "done" }),
      openAsk: (entry) =>
        openStreamEntry(serverId, agentId, {
          entryId: entry.id,
          query: splitEntryText(entry.text).headline || entry.text,
        }),
    };
  }, [agentId, client, openStreamEntry, serverId]);
  if (!supported || readOnly) return null;
  return (
    <TrackedAnswersPane
      entries={entries}
      agentId={agentId}
      actions={actions}
      showOpenAsks={showOpenAsks}
      agentTitle={agentTitle}
      sessions={sessions}
    />
  );
}
