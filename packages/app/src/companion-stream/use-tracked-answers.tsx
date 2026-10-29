import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import React, { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ToastApi } from "@/components/toast-host";
import { useHostFeature } from "@/runtime/host-features";
import { useAgentViewStore } from "@/stores/agent-view-store";
import { useSessionStore } from "@/stores/session-store";
import type { TimelinePosition } from "@/types/stream";
import type { TimelineJump } from "@/agent-stream/use-timeline-anchor-jump";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { trackedQuestionEntryId } from "./answers-model";
import { splitEntryText } from "./entry-labels";
import { TrackedAnswersPane, type AskDelegation, type TrackedAnswerActions } from "./answers-pane";
import { delegationTarget, delegationTargetKey, type DelegationTarget } from "./delegation-pulse";
import { useDelegatedHere, useDelegationPulses } from "./use-delegation-pulse";

type TrackQuestionHandler = (
  text: string,
  messageId?: string,
  timelineCursor?: TimelinePosition,
) => void;

const NO_ENTRIES: CompanionEntry[] = [];

/** The sessions working this chat's unresolved asks, one per child, in entry order. */
function useDelegationTargets(
  serverId: string,
  agentId: string,
  entries: readonly CompanionEntry[],
): DelegationTarget[] {
  return useMemo(() => {
    const byKey = new Map<string, DelegationTarget>();
    for (const entry of entries) {
      const target = delegationTarget(entry.ask, serverId, agentId);
      if (target) byKey.set(delegationTargetKey(target), target);
    }
    return [...byKey.values()];
  }, [agentId, entries, serverId]);
}

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
  const paneEntries = showOpenAsks ? entries : NO_ENTRIES;
  const agentTitle = useOwnerTitles(serverId, paneEntries);
  const targets = useDelegationTargets(serverId, agentId, paneEntries);
  const pulses = useDelegationPulses(targets);
  const delegation = useCallback(
    (entry: CompanionEntry): AskDelegation | null => {
      const target = delegationTarget(entry.ask, serverId, agentId);
      return target ? { target, pulse: pulses(target) } : null;
    },
    [agentId, pulses, serverId],
  );
  const delegatedHere = useDelegatedHere(serverId, agentId, showOpenAsks);
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
      openSession: (target) =>
        navigateToAgent({ serverId: target.serverId, agentId: target.agentId }),
      openOwnerAsk: (item) => {
        openStreamEntry(serverId, item.ownerAgentId, {
          entryId: item.entryId,
          query: item.headline,
        });
        navigateToAgent({ serverId, agentId: item.ownerAgentId });
      },
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
      delegation={delegation}
      delegatedHere={delegatedHere}
    />
  );
}
