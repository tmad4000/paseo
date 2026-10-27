import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CompanionEntry, TimelineAnchor } from "@getpaseo/protocol/companion-stream";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ToastApi } from "@/components/toast-host";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import type { TimelinePosition } from "@/types/stream";
import { trackedQuestionEntryId } from "./answers-model";
import { TrackedAnswersPane } from "./answers-pane";

type TrackQuestionHandler = (
  text: string,
  messageId?: string,
  timelineCursor?: TimelinePosition,
) => void;

const NO_ENTRIES: CompanionEntry[] = [];

// COMPAT(streamAnswers): fork feature; remove gate after 2027-04-26.
function useSupportsTrackedAnswers(serverId: string): boolean {
  return useHostFeature(serverId, "streamAnswers");
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

/** The answers pane for one chat, fed by the agent's live Stream snapshot. */
export function ChatTrackedAnswers({
  serverId,
  agentId,
  client,
  readOnly,
  onJump,
}: {
  serverId: string;
  agentId: string;
  client: DaemonClient | null;
  readOnly: boolean;
  onJump: (anchor: TimelineAnchor) => void;
}) {
  const supported = useSupportsTrackedAnswers(serverId);
  const entries = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))?.companionEntries ??
      NO_ENTRIES
    );
  });
  const markSeen = useCallback(
    async (entryId: string) => {
      if (!client) throw new Error("Not connected");
      await client.updateStreamEntry({
        agentId,
        action: "update_status",
        entryId,
        status: "reviewed",
      });
    },
    [agentId, client],
  );
  if (!supported || readOnly) return null;
  return <TrackedAnswersPane entries={entries} onJump={onJump} onMarkSeen={markSeen} />;
}
