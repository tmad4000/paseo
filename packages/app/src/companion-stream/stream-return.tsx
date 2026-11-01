import { useCallback, type ReactElement } from "react";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react-native";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { WorkflowView } from "./workflow-view";

/** Where the Stream was when a card opened a chat, so going back lands in the same place. */
export interface StreamPlace {
  view: WorkflowView;
  showLater: boolean;
  search: string;
  host: string;
  scrollOffset: number;
}

/** The chat a Stream card opened, and the Stream place to go back to from it. */
interface StreamReturnTarget {
  serverId: string;
  agentId: string;
  place: StreamPlace;
}

interface StreamReturnState {
  target: StreamReturnTarget | null;
  /** Set by the way back; the Stream applies it once and clears it. */
  restore: StreamPlace | null;
  setTarget: (target: StreamReturnTarget) => void;
  clear: () => void;
  goBack: () => StreamPlace | null;
  takeRestore: () => StreamPlace | null;
}

/** One target: the last chat opened from the Stream is the only one offering the way back. */
export const useStreamReturnStore = create<StreamReturnState>((set, get) => ({
  target: null,
  restore: null,
  setTarget: (target) => set({ target }),
  clear: () => set({ target: null }),
  goBack: () => {
    const place = get().target?.place ?? null;
    set({ target: null, restore: place });
    return place;
  },
  takeRestore: () => {
    const place = get().restore;
    if (place) set({ restore: null });
    return place;
  },
}));

export function streamViewHref(view: WorkflowView): Href {
  return (view === "activity" ? "/stream" : `/stream?view=${view}`) as Href;
}

/**
 * Back to Needs you (or the Stream view the chat was opened from). Shown beside Chat / Stream in
 * that one chat, so leaving the triage list to read context costs one tap to undo.
 */
export function StreamReturnButton({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const target = useStreamReturnStore((state) => state.target);
  const takeTarget = useStreamReturnStore((state) => state.goBack);
  const compact = useIsCompactFormFactor();
  const view = target?.place.view;
  const goBack = useCallback(() => {
    const place = takeTarget();
    if (place) router.navigate(streamViewHref(place.view));
  }, [takeTarget]);
  if (!target || target.serverId !== serverId || target.agentId !== agentId) return null;
  return (
    <Button
      variant="ghost"
      size={compact ? "md" : "sm"}
      leftIcon={ArrowLeft}
      onPress={goBack}
      accessibilityLabel={t(
        view === "needs_you" ? "globalStream.backToNeedsYou" : "globalStream.backToStream",
      )}
      testID="stream-return"
    >
      {t(view === "needs_you" ? "globalStream.needsYou" : "globalStream.title")}
    </Button>
  );
}
