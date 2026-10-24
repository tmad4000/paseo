import type { StreamTagCount } from "@getpaseo/protocol/global-stream";
import { memo, useCallback, useMemo, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type AccessibilityActionEvent,
  type PressableStateCallbackType,
} from "react-native";
import { Pin, PinOff, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { buildTagCloud, type TagCloudItem } from "./tag-model";

const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
const ThemedX = withUnistyles(X);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const COLLAPSED_LIMIT = 24;

export interface TagCloudProps {
  counts: readonly StreamTagCount[];
  pinned: readonly string[];
  active: readonly string[];
  onToggle: (tag: string) => void;
  onTogglePin?: (tag: string, pinned: boolean) => void;
  error?: string | null;
}

/** Wrapping chip row: pinned tags first with a pin glyph, then by count. Tap filters, long press pins. */
export const TagCloud = memo(function TagCloud({
  counts,
  pinned,
  active,
  onToggle,
  onTogglePin,
  error,
}: TagCloudProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const items = useMemo(() => buildTagCloud(counts, pinned, active), [counts, pinned, active]);
  const toggleShowAll = useCallback(() => setShowAll((value) => !value), []);
  if (!items.length) return null;
  const visible =
    showAll || items.length <= COLLAPSED_LIMIT
      ? items
      : items.filter((item, index) => index < COLLAPSED_LIMIT || item.active);
  const activeItems = items.filter((item) => item.active);
  return (
    <View style={styles.root} testID="stream-tag-cloud">
      {activeItems.length ? (
        <ActiveTagFilters items={activeItems} onToggle={onToggle} onTogglePin={onTogglePin} />
      ) : null}
      <View style={styles.cloud} accessibilityLabel={t("agentPanel.stream.tags.label")}>
        {visible.map((item) => (
          <TagChip key={item.tag} item={item} onToggle={onToggle} onTogglePin={onTogglePin} />
        ))}
        {items.length > COLLAPSED_LIMIT ? (
          <Pressable accessibilityRole="button" onPress={toggleShowAll} style={styles.more}>
            <Text style={styles.moreText}>
              {showAll
                ? t("agentPanel.stream.tags.showFewer")
                : t("agentPanel.stream.tags.showAll", { count: items.length })}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

function TagChip({
  item,
  onToggle,
  onTogglePin,
}: {
  item: TagCloudItem;
  onToggle: (tag: string) => void;
  onTogglePin?: (tag: string, pinned: boolean) => void;
}) {
  const { t } = useTranslation();
  const press = useCallback(() => onToggle(item.tag), [onToggle, item.tag]);
  const longPress = useCallback(
    () => onTogglePin?.(item.tag, !item.pinned),
    [onTogglePin, item.tag, item.pinned],
  );
  const accessibilityActions = useMemo(
    () =>
      onTogglePin
        ? [
            {
              name: "longpress",
              label: t(
                item.pinned ? "agentPanel.stream.tags.unpin" : "agentPanel.stream.tags.pin",
                {
                  tag: item.tag,
                },
              ),
            },
          ]
        : undefined,
    [onTogglePin, item.pinned, item.tag, t],
  );
  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "longpress") longPress();
    },
    [longPress],
  );
  const selected = useMemo(() => ({ selected: item.active }), [item.active]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected}
      accessibilityLabel={t(
        item.pinned ? "agentPanel.stream.tags.pinnedChip" : "agentPanel.stream.tags.chip",
        { tag: item.tag, count: item.count },
      )}
      accessibilityHint={onTogglePin ? t("agentPanel.stream.tags.longPressHint") : undefined}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      onPress={press}
      onLongPress={onTogglePin ? longPress : undefined}
      delayLongPress={450}
      testID={`stream-tag-${item.tag}`}
      style={item.active ? activeChipStyle : chipStyle}
    >
      {item.pinned ? <ThemedPin size={11} uniProps={mutedIcon} /> : null}
      <Text
        style={[
          styles.chipText,
          item.weight === 1 && styles.weight1,
          item.weight === 2 && styles.weight2,
          item.active && styles.chipTextActive,
        ]}
      >
        #{item.tag}
      </Text>
      {item.count ? <Text style={styles.count}>{item.count}</Text> : null}
    </Pressable>
  );
}

/** The active AND filter, shown above the list with remove and pin controls. */
function ActiveTagFilters({
  items,
  onToggle,
  onTogglePin,
}: {
  items: readonly TagCloudItem[];
  onToggle: (tag: string) => void;
  onTogglePin?: (tag: string, pinned: boolean) => void;
}) {
  const { t } = useTranslation();
  const clearAll = useCallback(() => {
    for (const item of items) onToggle(item.tag);
  }, [items, onToggle]);
  return (
    <View style={styles.activeRow} testID="stream-tag-filters">
      <Text style={styles.activeLabel}>{t("agentPanel.stream.tags.filteredBy")}</Text>
      {items.map((item) => (
        <ActiveTagChip key={item.tag} item={item} onToggle={onToggle} onTogglePin={onTogglePin} />
      ))}
      {items.length > 1 ? (
        <Pressable accessibilityRole="button" onPress={clearAll} style={styles.more}>
          <Text style={styles.moreText}>{t("agentPanel.stream.tags.clear")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ActiveTagChip({
  item,
  onToggle,
  onTogglePin,
}: {
  item: TagCloudItem;
  onToggle: (tag: string) => void;
  onTogglePin?: (tag: string, pinned: boolean) => void;
}) {
  const { t } = useTranslation();
  const remove = useCallback(() => onToggle(item.tag), [onToggle, item.tag]);
  const togglePin = useCallback(
    () => onTogglePin?.(item.tag, !item.pinned),
    [onTogglePin, item.tag, item.pinned],
  );
  return (
    <View style={styles.activeChip} testID={`stream-tag-filter-${item.tag}`}>
      <Text style={styles.chipTextActive}>#{item.tag}</Text>
      {onTogglePin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            item.pinned ? "agentPanel.stream.tags.unpin" : "agentPanel.stream.tags.pin",
            { tag: item.tag },
          )}
          onPress={togglePin}
          hitSlop={8}
          style={styles.iconButton}
        >
          {item.pinned ? (
            <ThemedPinOff size={13} uniProps={mutedIcon} />
          ) : (
            <ThemedPin size={13} uniProps={mutedIcon} />
          )}
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("agentPanel.stream.tags.remove", { tag: item.tag })}
        onPress={remove}
        hitSlop={8}
        style={styles.iconButton}
      >
        <ThemedX size={13} uniProps={mutedIcon} />
      </Pressable>
    </View>
  );
}

function chipStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.chip, (hovered || pressed) && styles.chipHovered];
}
function activeChipStyle() {
  return [styles.chip, styles.chipActive];
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.spacing[2] },
  cloud: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[1] },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  chipHovered: { backgroundColor: theme.colors.surface2 },
  chipActive: { borderColor: theme.colors.foregroundMuted, backgroundColor: theme.colors.surface2 },
  chipText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  weight1: { color: theme.colors.foreground, fontSize: 13 },
  weight2: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  chipTextActive: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  count: { color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] },
  more: { minHeight: 28, justifyContent: "center", paddingHorizontal: theme.spacing[2] },
  moreText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  activeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  activeLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  activeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 28,
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
  },
  iconButton: { padding: theme.spacing[1], borderRadius: theme.borderRadius.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
