import { useCallback, type ReactElement } from "react";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react-native";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import type { WorkflowView } from "./workflow-view";

/** The chat a Stream card opened, and the Stream view to go back to from it. */
interface StreamReturnTarget {
  serverId: string;
  agentId: string;
  view: WorkflowView;
}

interface StreamReturnState {
  target: StreamReturnTarget | null;
  setTarget: (target: StreamReturnTarget) => void;
  clear: () => void;
}

/** One target: the last chat opened from the Stream is the only one offering the way back. */
export const useStreamReturnStore = create<StreamReturnState>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
  clear: () => set({ target: null }),
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
  const clear = useStreamReturnStore((state) => state.clear);
  const view = target?.view;
  const goBack = useCallback(() => {
    if (!view) return;
    clear();
    router.navigate(streamViewHref(view));
  }, [view, clear]);
  if (!target || target.serverId !== serverId || target.agentId !== agentId) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
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
