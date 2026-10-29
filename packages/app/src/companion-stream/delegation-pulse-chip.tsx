import React, { memo, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
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
  testID = "delegation-pulse",
}: {
  pulse: DelegationPulse;
  name: string;
  onOpen: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const status = useDelegationStatusLabel(pulse);
  const dataSet = useMemo(
    () => ({ pulse: pulse.kind, attention: pulse.needsAttention ? "true" : "false" }),
    [pulse.kind, pulse.needsAttention],
  );
  return (
    <Pressable
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
      <PulseDot kind={pulse.kind} />
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

/** "Running · 4m", "Idle 12m · ask still open", …; the time keeps itself current. */
export function useDelegationStatusLabel(pulse: DelegationPulse): string {
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
      return timed
        ? t("agentPanel.stream.answers.delegation.idleFor", { time: timed })
        : t("agentPanel.stream.answers.delegation.idle");
    case "permission":
      return t("agentPanel.stream.answers.delegation.permission");
    case "error":
      return t("agentPanel.stream.answers.delegation.error");
    case "closed":
      return t("agentPanel.stream.answers.delegation.closed");
    case "starting":
      return t("agentPanel.stream.answers.delegation.starting");
    case "unknown":
      return t("agentPanel.stream.answers.delegation.unknown");
  }
}

function PulseDot({ kind }: { kind: DelegationPulseKind }) {
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
  }[DOT_TONE[kind]];
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
