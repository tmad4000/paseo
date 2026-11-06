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
}

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
    }),
    [
      descriptor.icon,
      descriptor.label,
      descriptor.tooltip,
      descriptor.statusBucket,
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
   * The tab's read level, drawn on the icon's corner badge: filled for new activity, a hollow
   * ring for seen-not-read, nothing once read. Red when the agent failed, accent otherwise. The
   * running ring and the needs-input alert keep priority. Left out, the badge shows the status
   * bucket as before (the split drag chip, subagents track and other non-strip icons).
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

type ReadBadge = Exclude<TabReadState, "read">;

/**
 * What the icon's corner shows. The running ring and needs-input alert keep priority; then the
 * read badge when the caller tracks read state; otherwise (no read state) the status bucket dot.
 */
function resolveCornerBadge(
  bucket: WorkspaceTabPresentation["statusBucket"],
  readState: TabReadState | undefined,
): { readBadge: ReadBadge | null; color: string | undefined } {
  if (bucket === "running" || bucket === "needs_input")
    return { readBadge: null, color: undefined };
  if (readState === "new" || readState === "seen") {
    const color = bucket === "failed" ? styles.statusDotFailed.color : styles.statusDotUnread.color;
    return { readBadge: readState, color };
  }
  if (readState === "read") return { readBadge: null, color: undefined };
  if (bucket === "failed") return { readBadge: null, color: styles.statusDotFailed.color };
  if (bucket === "attention") return { readBadge: null, color: styles.statusDotAttention.color };
  return { readBadge: null, color: undefined };
}

function TabReadBadge({
  readBadge,
  color,
  knockoutColor,
  presentationKey,
}: {
  readBadge: ReadBadge;
  color: string | undefined;
  knockoutColor: string | undefined;
  presentationKey: string;
}): ReactElement {
  const { t } = useTranslation();
  const seen = readBadge === "seen";
  const badgeStyle = useMemo(
    () => [
      styles.statusDot,
      // A seen ring is hollow: the badge fills with the surface and the ring draws inside it.
      { backgroundColor: seen ? knockoutColor : color, borderColor: knockoutColor },
    ],
    [color, knockoutColor, seen],
  );
  const seenRingStyle = useMemo(() => [styles.seenRing, { borderColor: color }], [color]);
  const dataSet = useMemo(() => ({ readState: readBadge }), [readBadge]);
  const label = seen
    ? t("workspace.tabs.seenNotRead", { defaultValue: "Seen, not read" })
    : t("workspace.tabs.newActivity", { defaultValue: "New activity" });
  return (
    <View
      style={badgeStyle}
      dataSet={dataSet}
      accessibilityLabel={label}
      testID={`workspace-tab-unread-${presentationKey}`}
    >
      {seen ? (
        <View style={seenRingStyle} testID={`workspace-tab-seen-${presentationKey}`} />
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
  const iconColor = active ? styles.iconActive.color : styles.iconInactive.color;
  const bucket = presentation.statusBucket;
  const isRunning = bucket === "running";
  const showNeedsInputAlert = bucket === "needs_input";
  const { readBadge, color: statusDotColor } = resolveCornerBadge(bucket, readState);
  const Icon = presentation.icon;
  const agentIconWrapperStyle = useMemo(
    () => [styles.agentIconWrapper, { width: size, height: size }],
    [size],
  );
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
  let cornerDot: ReactElement | null = null;
  if (readBadge) {
    cornerDot = (
      <TabReadBadge
        readBadge={readBadge}
        color={statusDotColor}
        knockoutColor={statusDotBorderColor ?? styles[`knockout_${backdrop}`].color}
        presentationKey={presentation.key}
      />
    );
  } else if (statusDotColor) {
    cornerDot = <View style={statusDotStyle} />;
  }

  return (
    <View style={agentIconWrapperStyle}>
      <Icon size={size} color={iconColor} strokeWidth={strokeWidth} />
      {isRunning ? (
        <View
          style={styles.statusRing}
          accessibilityRole="progressbar"
          accessibilityLabel="Agent running"
        >
          <StatusRing backdrop={backdrop} />
        </View>
      ) : null}
      {cornerDot}
      {showNeedsInputAlert ? (
        <View style={styles.statusAlertOverlay}>
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
}

export function WorkspaceTabOptionRow({
  presentation,
  selected,
  active,
  unread = false,
  seen = false,
  onPress,
  trailingAccessory,
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
        accessibilityLabel={presentation.label}
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
                <Text numberOfLines={1} style={styles.optionLabel}>
                  {presentation.titleState === "loading"
                    ? t("workspace.tabs.loading")
                    : presentation.label}
                </Text>
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
    minHeight: 36,
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
