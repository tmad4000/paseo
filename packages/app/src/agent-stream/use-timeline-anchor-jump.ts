import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { TimelineAnchor } from "@getpaseo/protocol/companion-stream";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { planTimelinePromptJump } from "@/timeline/timeline-sync-plan";
import type { StreamItem } from "@/types/stream";
import { getStreamItemMessageId } from "./presentation";
import type { StreamViewportHandle } from "./strategy";

interface PendingAnchorJump {
  requestId: number;
  anchor: TimelineAnchor;
  fetchSettled: boolean;
  hasScrolled: boolean;
}

export interface UseTimelineAnchorJumpInput {
  agentId: string;
  serverId: string;
  timelineEpoch: string | null;
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  viewportRef: RefObject<StreamViewportHandle | null>;
  visibleMessageIds?: ReadonlySet<string>;
  revealLoadedMessage?: (messageId: string) => boolean;
  /** The anchor's epoch is gone, or its window could not be loaded. */
  onUnavailable: () => void;
}

const NO_STREAM_ITEMS: StreamItem[] = [];

/** The loaded message an anchor points at; assistant blocks share one message id. */
export function findAnchoredItem(
  items: readonly StreamItem[],
  anchor: TimelineAnchor,
): StreamItem | undefined {
  return items.find((item) => {
    const cursor = item.timelineCursor;
    return (
      cursor?.epoch === anchor.epoch && cursor.seq >= anchor.startSeq && cursor.seq <= anchor.endSeq
    );
  });
}

/** A loaded user message by provider or client message id, as recorded on a tracked ask. */
export function findMessageItem(
  items: readonly StreamItem[],
  messageId: string,
): StreamItem | undefined {
  return items.find(
    (item) =>
      item.kind === "user_message" &&
      (item.messageId === messageId || item.clientMessageId === messageId),
  );
}

export interface TimelineJump {
  jumpToAnchor: (anchor: TimelineAnchor) => void;
  /** Only messages already loaded in Chat; a message id carries no timeline position. */
  jumpToMessage: (messageId: string) => void;
  /** True when the message is loaded in Chat, so jumpToMessage can land on it. */
  hasMessage: (messageId: string) => boolean;
}

/**
 * Scrolls Chat to a Stream entry's timeline anchor. Like the outline's prompt jump, an
 * anchor outside the loaded window fetches the window around it and scrolls once it lands.
 */
export function useTimelineAnchorJump({
  agentId,
  serverId,
  timelineEpoch,
  tail,
  head,
  viewportRef,
  visibleMessageIds,
  revealLoadedMessage,
  onUnavailable,
}: UseTimelineAnchorJumpInput): TimelineJump {
  const [pendingJump, setPendingJump] = useState<PendingAnchorJump | null>(null);
  const nextRequestIdRef = useRef(0);
  const loadedItems = useMemo(() => [...tail, ...(head ?? NO_STREAM_ITEMS)], [head, tail]);

  useEffect(() => {
    nextRequestIdRef.current += 1;
    setPendingJump(null);
  }, [agentId, timelineEpoch]);

  const scrollTo = useCallback(
    (item: StreamItem): boolean => {
      const messageId = getStreamItemMessageId(item);
      if (visibleMessageIds?.has(messageId) === false && revealLoadedMessage?.(messageId)) {
        return false;
      }
      viewportRef.current?.scrollToMessage?.(messageId);
      return true;
    },
    [revealLoadedMessage, viewportRef, visibleMessageIds],
  );

  useEffect(() => {
    if (pendingJump === null || pendingJump.hasScrolled) return;
    const target = findAnchoredItem(loadedItems, pendingJump.anchor);
    if (target) {
      if (!scrollTo(target)) return;
      setPendingJump((current) =>
        current?.requestId === pendingJump.requestId ? { ...current, hasScrolled: true } : current,
      );
      return;
    }
    if (pendingJump.fetchSettled) {
      setPendingJump(null);
      onUnavailable();
    }
  }, [loadedItems, onUnavailable, pendingJump, scrollTo]);

  const jumpToAnchor = useCallback(
    (anchor: TimelineAnchor) => {
      nextRequestIdRef.current += 1;
      const requestId = nextRequestIdRef.current;
      setPendingJump(null);
      if (anchor.epoch !== timelineEpoch) {
        onUnavailable();
        return;
      }
      const loaded = findAnchoredItem(loadedItems, anchor);
      if (loaded) {
        if (!scrollTo(loaded)) {
          setPendingJump({ requestId, anchor, fetchSettled: true, hasScrolled: false });
        }
        return;
      }
      setPendingJump({ requestId, anchor, fetchSettled: false, hasScrolled: false });
      void getHostRuntimeStore()
        .fetchAgentTimeline(
          serverId,
          agentId,
          planTimelinePromptJump({ epoch: anchor.epoch, seq: anchor.startSeq }),
        )
        .catch((error: unknown) => {
          console.warn("Failed to load the Chat window for a tracked question", error);
        })
        .finally(() => {
          setPendingJump((current) =>
            current?.requestId === requestId ? { ...current, fetchSettled: true } : current,
          );
        });
    },
    [agentId, loadedItems, onUnavailable, scrollTo, serverId, timelineEpoch],
  );
  const jumpToMessage = useCallback(
    (messageId: string) => {
      nextRequestIdRef.current += 1;
      setPendingJump(null);
      const loaded = findMessageItem(loadedItems, messageId);
      if (loaded) scrollTo(loaded);
      else onUnavailable();
    },
    [loadedItems, onUnavailable, scrollTo],
  );
  const hasMessage = useCallback(
    (messageId: string) => findMessageItem(loadedItems, messageId) !== undefined,
    [loadedItems],
  );
  return useMemo(
    () => ({ jumpToAnchor, jumpToMessage, hasMessage }),
    [hasMessage, jumpToAnchor, jumpToMessage],
  );
}
