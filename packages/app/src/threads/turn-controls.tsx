import { memo, useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MessageSquareReply } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { AssistantTurnForkBoundary } from "@/agent-stream/turn-boundary";
import { useThreadsHost } from "./context";
import { threadAnchorKey, type ThreadReply } from "./model";

const ThemedReplyIcon = withUnistyles(MessageSquareReply);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const NO_REPLIES: readonly ThreadReply[] = [];

/**
 * "Reply in thread" and the "N replies" chip at the end of a completed assistant turn. Renders
 * nothing outside an agent panel (no threads host) or when the turn has no forkable boundary.
 */
export const ThreadTurnControls = memo(function ThreadTurnControls({
  boundary,
  onStartThread,
}: {
  boundary: AssistantTurnForkBoundary | undefined;
  onStartThread: () => Promise<void> | void;
}) {
  const host = useThreadsHost();
  const anchor = boundary ? threadAnchorKey(boundary) : null;
  const replies = (anchor && host?.repliesByAnchor.get(anchor)) || NO_REPLIES;
  if (!host || !anchor) return null;
  return (
    <View style={styles.row}>
      <ReplyInThreadButton onStartThread={onStartThread} />
      {replies.length > 0 ? <ThreadRepliesChip replies={replies} onOpen={host.openThread} /> : null}
    </View>
  );
});

function ReplyInThreadButton({ onStartThread }: { onStartThread: () => Promise<void> | void }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const handlePress = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await onStartThread();
    } finally {
      setPending(false);
    }
  }, [onStartThread, pending]);
  const triggerStyle = useCallback(
    ({ hovered = false }: { hovered?: boolean }) => [
      styles.iconButton,
      hovered && styles.iconButtonHovered,
      pending && styles.pending,
    ],
    [pending],
  );
  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("threads.replyInThread")}
          disabled={pending}
          onPress={handlePress}
          style={triggerStyle}
          testID="turn-reply-in-thread"
        >
          {({ hovered }: { hovered?: boolean }) => (
            <ThemedReplyIcon
              size={ICON_SIZE.sm}
              uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("threads.replyInThread")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ThreadRepliesChip({
  replies,
  onOpen,
}: {
  replies: readonly ThreadReply[];
  onOpen: (threadAgentId: string) => void;
}) {
  const { t } = useTranslation();
  const label = t("threads.replies", { count: replies.length });
  const only = replies.length === 1 ? replies[0] : undefined;
  const openOnly = useCallback(() => {
    if (only) onOpen(only.agentId);
  }, [only, onOpen]);
  if (only) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("threads.openThread", { title: only.title })}
        onPress={openOnly}
        style={chipStyle}
        testID="turn-thread-replies"
      >
        <Text style={styles.chipText}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        style={chipStyle}
        testID="turn-thread-replies"
      >
        <Text style={styles.chipText}>{label}</Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" minWidth={220} side="bottom">
        {replies.map((reply) => (
          <ThreadReplyItem key={reply.agentId} reply={reply} onOpen={onOpen} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThreadReplyItem({
  reply,
  onOpen,
}: {
  reply: ThreadReply;
  onOpen: (threadAgentId: string) => void;
}) {
  const handleSelect = useCallback(() => onOpen(reply.agentId), [onOpen, reply.agentId]);
  return (
    <DropdownMenuItem onSelect={handleSelect} testID={`turn-thread-reply-${reply.agentId}`}>
      {reply.title}
    </DropdownMenuItem>
  );
}

function chipStyle({ hovered = false }: { hovered?: boolean }) {
  return [styles.chip, hovered && styles.chipHovered];
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  iconButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  iconButtonHovered: { backgroundColor: theme.colors.surface2 },
  pending: { opacity: theme.opacity[50] },
  chip: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipHovered: { backgroundColor: theme.colors.surface2 },
  chipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  tooltipText: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
}));
