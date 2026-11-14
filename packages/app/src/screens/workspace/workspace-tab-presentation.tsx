import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Check, CircleAlert } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import { getPanelRegistration, type PanelIconProps } from "@/panels/panel-registry";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { StatusRing } from "@/components/status-ring";
import { getStatusRingOffset } from "@/components/status-ring/geometry";
import {
  STATUS_INDICATOR_ALERT_SIZE,
  STATUS_INDICATOR_DOT_SIZE,
  STATUS_INDICATOR_FILLED_DOT_SIZE,
} from "@/utils/status-indicator-geometry";
import type { Theme } from "@/styles/theme";
import { usePanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import type { TabReadState } from "@/screens/workspace/workspace-tab-activity";
import {
  resolveTabStatusMarks,
  type TabStatusMarks,
} from "@/screens/workspace/workspace-tab-status-marks";

export interface WorkspaceTabPresentation {
  key: string;
  kind: WorkspaceTabDescriptor["kind"];
  label: string;
  subtitle: string;
  tooltip: string;
  modified: boolean;
  titleState: "ready" | "loading";
  icon: React.ComponentType<PanelIconProps>;
  statusBucket: SidebarStateBucket | null;
  /** Working right now, even when the bucket reports needs_input, so both marks can show. */
  running: boolean;
}

/** How far the seen dot sits left of the read ring, so the two circles overlap. */
const READ_PAIR_OFFSET = 4;
const DEFAULT_STATUS_DOT_OFFSET = -2;
const STATUS_ALERT_OFFSET = -3;

interface WorkspaceTabPresentationResolverProps {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  children: (presentation: WorkspaceTabPresentation) => ReactNode;
}

type WorkspaceTabPresentationResolverInnerProps = WorkspaceTabPresentationResolverProps & {
  registration: NonNullable<ReturnType<typeof getPanelRegistration>>;
};

export function WorkspaceTabPresentationResolver({
  tab,
  serverId,
  workspaceId,
  children,
}: WorkspaceTabPresentationResolverProps): ReactElement {
  ensurePanelsRegistered();
  const registration = getPanelRegistration(tab.kind);
  invariant(registration, `No panel registration for kind: ${tab.kind}`);

  return (
    <WorkspaceTabPresentationResolverInner
      key={`${tab.key}:${tab.kind}`}
      registration={registration}
      tab={tab}
      serverId={serverId}
      workspaceId={workspaceId}
    >
      {children}
    </WorkspaceTabPresentationResolverInner>
  );
}

function WorkspaceTabPresentationResolverInner({
  registration,
  tab,
  serverId,
  workspaceId,
  children,
}: WorkspaceTabPresentationResolverInnerProps): ReactElement {
  const descriptor = registration.useDescriptor(tab.target as never, {
    serverId,
    workspaceId,
    tabId: tab.tabId,
  });
  const attributes = usePanelInstanceAttributes({ serverId, workspaceId, tabId: tab.tabId });

  const presentation = useMemo(
    () => ({
      key: tab.key,
      kind: tab.kind,
      label: descriptor.label,
      subtitle: descriptor.subtitle,
      tooltip: descriptor.tooltip,
      modified: attributes.modified,
      titleState: descriptor.titleState,
      icon: descriptor.icon,
      statusBucket: descriptor.statusBucket,
      running: descriptor.statusRunning ?? descriptor.statusBucket === "running",
    }),
    [
      descriptor.icon,
      descriptor.label,
      descriptor.tooltip,
      descriptor.statusBucket,
      descriptor.statusRunning,
      descriptor.subtitle,
      descriptor.titleState,
      tab.key,
      tab.kind,
      attributes.modified,
    ],
  );

  return <>{children(presentation)}</>;
}

interface WorkspaceTabIconProps {
  presentation: WorkspaceTabPresentation;
  active?: boolean;
  size?: number;
  strokeWidth?: number;
  statusDotBorderColor?: string;
  /**
   * The surface this icon is sitting on, so the running ring can knock out of it. This icon is
   * shared by the desktop tab strip, the tab switcher trigger, the split drag chip and the
   * subagents track, which are on different surfaces and some of which change surface on hover —
   * it cannot work the colour out for itself.
   */
  backdrop: SurfaceBackdrop;
  /**
   * The tab's read level, drawn as two overlapping circles (see `resolveTabStatusMarks`): a
   * hollow read ring while unread, with a filled seen dot in front while this device has not
   * looked at the latest activity. They stay visible while the agent runs or needs input. Left
   * out, the corner shows the status bucket as before (the split drag chip, subagents track and
   * other non-strip icons).
   */
  readState?: TabReadState;
}

const ThemedCheckIcon = withUnistyles(Check);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const needsInputAlertMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
  fill: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
});

function TabReadLayers({
  marks,
  knockoutColor,
  presentationKey,
}: {
  marks: NonNullable<TabStatusMarks["read"]>;
  knockoutColor: string | undefined;
  presentationKey: string;
}): ReactElement {
  const { t } = useTranslation();
  const color =
    marks.tone === "failed" ? styles.statusDotFailed.color : styles.statusDotUnread.color;
  const pairStyle = useMemo(
    () => [styles.readPair, marks.placement === "topRight" ? styles.readPairTop : null],
    [marks.placement],
  );
  const ringShellStyle = useMemo(
    () => [
      styles.readPairCircle,
      styles.readPairRing,
      { backgroundColor: knockoutColor, borderColor: knockoutColor },
    ],
    [knockoutColor],
  );
  const ringStyle = useMemo(() => [styles.seenRing, { borderColor: color }], [color]);
  const dotStyle = useMemo(
    () => [
      styles.readPairCircle,
      styles.readPairDot,
      { backgroundColor: color, borderColor: knockoutColor },
    ],
    [color, knockoutColor],
  );
  const readState = marks.unseen ? "new" : "seen";
  const dataSet = useMemo(
    () => ({ readState, placement: marks.placement }),
    [readState, marks.placement],
  );
  const unreadLabel = t("workspace.tabs.readLayerUnread", { defaultValue: "Unread" });
  const seenLabel = marks.unseen
    ? t("workspace.tabs.seenLayerNotSeen", { defaultValue: "Not seen since last activity" })
    : t("workspace.tabs.seenLayerSeen", { defaultValue: "Seen" });
  return (
    <View
      style={pairStyle}
      dataSet={dataSet}
      accessibilityLabel={`${unreadLabel} · ${seenLabel}`}
      testID={`workspace-tab-unread-${presentationKey}`}
    >
      {/* Seen keeps the `workspace-tab-seen-` id on the lone read ring (#178's contract). */}
      <View
        style={ringShellStyle}
        testID={
          marks.unseen
            ? `workspace-tab-read-ring-${presentationKey}`
            : `workspace-tab-seen-${presentationKey}`
        }
      >
        <View style={ringStyle} />
      </View>
      {marks.unseen ? (
        <View style={dotStyle} testID={`workspace-tab-unseen-${presentationKey}`} />
      ) : null}
    </View>
  );
}

export function WorkspaceTabIcon({
  presentation,
  active = false,
  size = 14,
  strokeWidth,
  statusDotBorderColor,
  backdrop,
  readState,
}: WorkspaceTabIconProps): ReactElement {
  const { t } = useTranslation();
  const iconColor = active ? styles.iconActive.color : styles.iconInactive.color;
  const marks = resolveTabStatusMarks({
    bucket: presentation.statusBucket,
    running: presentation.running,
    readState,
  });
  const Icon = presentation.icon;
  const agentIconWrapperStyle = useMemo(
    () => [styles.agentIconWrapper, { width: size, height: size }],
    [size],
  );
  let statusDotColor: string | undefined;
  if (marks.statusDot === "failed") statusDotColor = styles.statusDotFailed.color;
  else if (marks.statusDot === "attention") statusDotColor = styles.statusDotAttention.color;
  const statusDotStyle = useMemo(
    () => [
      styles.statusDot,
      {
        backgroundColor: statusDotColor,
        borderColor: statusDotBorderColor ?? styles.statusDotBorderDefault.borderColor,
      },
    ],
    [statusDotColor, statusDotBorderColor],
  );
  const alertStyle =
    marks.needsInput === "topLeft" ? styles.statusAlertTopLeft : styles.statusAlertOverlay;

  return (
    <View style={agentIconWrapperStyle}>
      <Icon size={size} color={iconColor} strokeWidth={strokeWidth} />
      {marks.running ? (
        <View
          style={styles.statusRing}
          accessibilityRole="progressbar"
          accessibilityLabel={t("workspace.tabs.agentRunning", { defaultValue: "Agent running" })}
          testID={`workspace-tab-running-${presentation.key}`}
        >
          <StatusRing backdrop={backdrop} />
        </View>
      ) : null}
      {marks.statusDot ? <View style={statusDotStyle} /> : null}
      {marks.read ? (
        <TabReadLayers
          marks={marks.read}
          knockoutColor={statusDotBorderColor ?? styles[`knockout_${backdrop}`].color}
          presentationKey={presentation.key}
        />
      ) : null}
      {marks.needsInput ? (
        <View
          style={alertStyle}
          accessibilityLabel={t("workspace.tabs.needsInput", { defaultValue: "Needs input" })}
          testID={`workspace-tab-needs-input-${presentation.key}`}
        >
          <ThemedCircleAlert size={STATUS_INDICATOR_ALERT_SIZE} uniProps={needsInputAlertMapping} />
        </View>
      ) : null}
    </View>
  );
}

interface WorkspaceTabOptionRowProps {
  presentation: WorkspaceTabPresentation;
  selected: boolean;
  active: boolean;
  unread?: boolean;
  /** Unread, but already looked at on this device: the icon badge is a ring, not filled. */
  seen?: boolean;
  onPress: () => void;
  trailingAccessory?: ReactNode;
  showSubtitle?: boolean;
}

export function WorkspaceTabOptionRow({
  presentation,
  selected,
  active,
  unread = false,
  seen = false,
  onPress,
  trailingAccessory,
  showSubtitle = false,
}: WorkspaceTabOptionRowProps): ReactElement {
  const { t } = useTranslation();
  let readState: TabReadState = "read";
  if (unread) readState = seen ? "seen" : "new";
  const unreadHint = seen
    ? t("workspace.tabs.seenNotRead", { defaultValue: "Seen, not read" })
    : t("workspace.tabs.newActivity", { defaultValue: "New activity" });
  const isOptionActive = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      Boolean(hovered) || pressed || active,
    [active],
  );
  const pressableStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionMainPressable,
      isOptionActive(state) && styles.optionRowActive,
    ],
    [isOptionActive],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const optionRowStyle = useMemo(
    () => [styles.optionRow, active && styles.optionRowActive],
    [active],
  );
  return (
    <View style={optionRowStyle}>
      <Pressable
        onPress={onPress}
        style={pressableStyle}
        accessibilityRole="button"
        accessibilityLabel={
          showSubtitle ? `${presentation.label}, ${presentation.subtitle}` : presentation.label
        }
        accessibilityState={accessibilityState}
        accessibilityHint={unread ? unreadHint : undefined}
      >
        {(state) => {
          const optionActive = isOptionActive(state);
          return (
            <>
              <View style={styles.optionLeadingSlot}>
                <WorkspaceTabIcon
                  presentation={presentation}
                  active={selected || active}
                  backdrop={optionActive ? "surface1" : "surface0"}
                  readState={readState}
                />
              </View>
              <View style={styles.optionContent}>
                <Text numberOfLines={showSubtitle ? 2 : 1} style={styles.optionLabel}>
                  {presentation.titleState === "loading"
                    ? t("workspace.tabs.loading")
                    : presentation.label}
                </Text>
                {showSubtitle && presentation.subtitle ? (
                  <Text numberOfLines={2} style={styles.optionSubtitle}>
                    {presentation.subtitle}
                  </Text>
                ) : null}
              </View>
            </>
          );
        }}
      </Pressable>
      {presentation.modified ? (
        <View style={styles.optionModifiedDot} accessibilityLabel={t("workspace.tabs.modified")} />
      ) : null}
      {selected ? (
        <View style={styles.optionTrailingSlot}>
          <ThemedCheckIcon size={16} uniProps={mutedColorMapping} />
        </View>
      ) : null}
      {trailingAccessory ? (
        <View style={styles.optionTrailingAccessorySlot}>{trailingAccessory}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  agentIconWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  statusDot: {
    position: "absolute",
    right: DEFAULT_STATUS_DOT_OFFSET,
    bottom: DEFAULT_STATUS_DOT_OFFSET,
    width: STATUS_INDICATOR_DOT_SIZE,
    height: STATUS_INDICATOR_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  statusRing: {
    position: "absolute",
    right: getStatusRingOffset(DEFAULT_STATUS_DOT_OFFSET, STATUS_INDICATOR_DOT_SIZE),
    bottom: getStatusRingOffset(DEFAULT_STATUS_DOT_OFFSET, STATUS_INDICATOR_DOT_SIZE),
  },
  statusDotBorderDefault: {
    borderColor: theme.colors.surface0,
  },
  statusAlertOverlay: {
    position: "absolute",
    right: STATUS_ALERT_OFFSET,
    bottom: STATUS_ALERT_OFFSET,
  },
  statusAlertTopLeft: {
    position: "absolute",
    left: STATUS_ALERT_OFFSET,
    top: STATUS_ALERT_OFFSET,
  },
  readPair: {
    position: "absolute",
    right: DEFAULT_STATUS_DOT_OFFSET,
    bottom: DEFAULT_STATUS_DOT_OFFSET,
    width: STATUS_INDICATOR_DOT_SIZE + READ_PAIR_OFFSET,
    height: STATUS_INDICATOR_DOT_SIZE,
  },
  readPairTop: {
    bottom: undefined,
    top: DEFAULT_STATUS_DOT_OFFSET,
  },
  readPairCircle: {
    position: "absolute",
    top: 0,
    width: STATUS_INDICATOR_DOT_SIZE,
    height: STATUS_INDICATOR_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  readPairRing: {
    right: 0,
  },
  readPairDot: {
    left: 0,
  },
  statusDotFailed: {
    color: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
  },
  statusDotRunning: {
    color: getStatusDotColor({ theme, bucket: "running" }) ?? undefined,
  },
  statusDotAttention: {
    color: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
  statusDotUnread: {
    color: theme.colors.accent,
  },
  seenRing: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1.5,
  },
  knockout_surface0: { color: theme.colors.surface0 },
  knockout_surface1: { color: theme.colors.surface1 },
  knockout_surface2: { color: theme.colors.surface2 },
  knockout_surfaceSidebar: { color: theme.colors.surfaceSidebar },
  knockout_surfaceSidebarHover: { color: theme.colors.surfaceSidebarHover },
  knockout_surfaceSidebarSelected: { color: theme.colors.surfaceSidebarSelected },
  iconActive: {
    color: theme.colors.foreground,
  },
  iconInactive: {
    color: theme.colors.foregroundMuted,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    borderRadius: 0,
    marginHorizontal: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  optionMainPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  optionRowActive: {
    backgroundColor: theme.colors.surface1,
  },
  optionLeadingSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionContent: {
    flex: 1,
    flexShrink: 1,
  },
  optionSubtitle: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  optionLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  optionTrailingSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionModifiedDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  optionTrailingAccessorySlot: {
    alignItems: "center",
    justifyContent: "center",
  },
}));
