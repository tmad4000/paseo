import React, { memo, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useMiddleClickOpensTab } from "@/subthreads/peek-intent";
import type { DelegationPulse, DelegationPulseKind } from "./delegation-pulse";

const PULSE_MS = 1100;
const ANIMATED_DATA_SET = { animated: "true" };
const STATIC_DATA_SET = { animated: "false" };

/** Dot tone per state: blue while working, amber when it waits on you, red on failure. */
const DOT_TONE: Record<DelegationPulseKind, "running" | "warning" | "danger" | "muted"> = {
  running: "running",
  starting: "running",
  permission: "warning",
  idle: "warning",
  closed: "warning",
  error: "danger",
  unknown: "muted",
};

/**
 * The child working a delegated ask, live: a status dot (pulsing only while the child runs, and
 * never with reduced motion), the child's name as a link to its chat, and its state with elapsed
 * time. States that hand the loop back to the delegator read in the warning tone.
 */
export const DelegationPulseChip = memo(function DelegationPulseChip({
  pulse,
  name,
  onOpen,
  onOpenTab,
  testID = "delegation-pulse",
}: {
  pulse: DelegationPulse;
  name: string;
  /** Receives the press, so Mod+click on web can ask for the child's tab instead of a peek. */
  onOpen: (event?: GestureResponderEvent) => void;
  /** Web middle-click: the child's tab directly. */
  onOpenTab?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<View>(null);
  useMiddleClickOpensTab(ref, onOpenTab ?? null);
  const status = useDelegationStatusLabel(pulse);
  const dataSet = useMemo(
    () => ({ pulse: pulse.kind, attention: pulse.needsAttention ? "true" : "false" }),
    [pulse.kind, pulse.needsAttention],
  );
  return (
    <Pressable
      ref={ref}
      onPress={onOpen}
      style={styles.chip}
      accessibilityRole="link"
      accessibilityLabel={t("agentPanel.stream.answers.delegation.openChildLabel", {
        name,
        status,
      })}
      hitSlop={6}
      testID={testID}
      dataSet={dataSet}
    >
      <PulseDot kind={pulse.kind} quiet={pulse.tracked === false && !pulse.needsAttention} />
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Text
        style={[styles.status, pulse.needsAttention && styles.statusAttention]}
        numberOfLines={1}
        testID={`${testID}-status`}
      >
        {status}
      </Text>
    </Pressable>
  );
});

/**
 * "Running · 4m", "Idle 12m · ask still open", "Idle 3h · 1 question for you", …; the time keeps
 * itself current. A child no ask tracks reads plain "Idle" or "Closed": nothing was left open.
 */
export function useDelegationStatusLabel(pulse: DelegationPulse): string {
  const { t } = useTranslation();
  const state = useDelegationStateLabel(pulse);
  if (!pulse.questions) return state;
  return t("agentPanel.stream.answers.delegation.withQuestions", {
    status: state,
    questions: t("agentPanel.stream.answers.delegation.questionsForYou", {
      count: pulse.questions,
    }),
  });
}

function useDelegationStateLabel(pulse: DelegationPulse): string {
  const { t } = useTranslation();
  const since = useMemo(() => (pulse.since === null ? null : new Date(pulse.since)), [pulse.since]);
  const elapsed = useCompactTimeAgo(since);
  const timed = elapsed && elapsed !== "now" ? elapsed : null;
  switch (pulse.kind) {
    case "running":
      return timed
        ? t("agentPanel.stream.answers.delegation.runningFor", { time: timed })
        : t("agentPanel.stream.answers.delegation.running");
    case "idle":
      if (pulse.tracked === false) {
        return timed
          ? t("agentPanel.stream.answers.delegation.untrackedIdleFor", {
              time: timed,
            })
          : t("agentPanel.stream.answers.delegation.untrackedIdle");
      }
      return timed
        ? t("agentPanel.stream.answers.delegation.idleFor", { time: timed })
        : t("agentPanel.stream.answers.delegation.idle");
    case "permission":
      return t("agentPanel.stream.answers.delegation.permission");
    case "error":
      return t("agentPanel.stream.answers.delegation.error");
    case "closed":
      return t(
        pulse.tracked === false
          ? "agentPanel.stream.answers.delegation.untrackedClosed"
          : "agentPanel.stream.answers.delegation.closed",
      );
    case "starting":
      return t("agentPanel.stream.answers.delegation.starting");
    case "unknown":
      return t("agentPanel.stream.answers.delegation.unknown");
  }
}

/** `quiet`: an untracked child at rest; its dot is muted rather than a warning. */
function PulseDot({ kind, quiet }: { kind: DelegationPulseKind; quiet: boolean }) {
  const reduceMotion = useReducedMotion();
  // A retained, hidden panel keeps its rows mounted; only a visible one pulses.
  const active = useRetainedPanelActive();
  const animate = kind === "running" && !reduceMotion && active;
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!animate) {
      cancelAnimation(opacity);
      opacity.value = 1;
      return undefined;
    }
    opacity.value = withRepeat(withTiming(0.3, { duration: PULSE_MS }), -1, true);
    return () => cancelAnimation(opacity);
  }, [animate, opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const toneStyle = {
    running: styles.dotRunning,
    warning: styles.dotWarning,
    danger: styles.dotDanger,
    muted: styles.dotMuted,
  }[quiet && DOT_TONE[kind] === "warning" ? "muted" : DOT_TONE[kind]];
  return (
    <View style={styles.dotSlot}>
      <Animated.View
        style={[styles.dot, toneStyle, animatedStyle]}
        testID="delegation-pulse-dot"
        dataSet={animate ? ANIMATED_DATA_SET : STATIC_DATA_SET}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  dotSlot: {
    width: 10,
    height: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: theme.borderRadius.full,
  },
  dotRunning: {
    backgroundColor: theme.colors.statusDotRunning,
  },
  dotWarning: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  dotDanger: {
    backgroundColor: theme.colors.statusDotDanger,
  },
  dotMuted: {
    backgroundColor: theme.colors.border,
  },
  name: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
  status: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  statusAttention: {
    color: theme.colors.statusWarning,
  },
}));
