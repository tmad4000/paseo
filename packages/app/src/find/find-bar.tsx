import { useCallback, useEffect, useRef } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { ChevronDown, ChevronUp, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { getIsElectronRuntime } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { useFindStore } from "@/find/find-store";

const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedX = withUnistyles(X);
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Renders as data-paseo-find-bar, which the highlighter uses to skip the bar's
// own text so the query never matches itself.
const FIND_BAR_DATASET = { paseoFindBar: "" } as const;

type WebTextInputKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean }
>;

/**
 * The Cmd+F bar.
 *
 * Desktop-only: an Electron window has no browser chrome, so it has no native
 * find. A plain web build still has the browser's own Cmd+F, which is better
 * than anything reimplemented here.
 */
export function FindBar() {
  const { t } = useTranslation();
  const isOpen = useFindStore((state) => state.isOpen);
  const query = useFindStore((state) => state.query);
  const matches = useFindStore((state) => state.matches);
  const activeIndex = useFindStore((state) => state.activeIndex);
  const setQuery = useFindStore((state) => state.setQuery);
  const findNext = useFindStore((state) => state.findNext);
  const findPrevious = useFindStore((state) => state.findPrevious);
  const close = useFindStore((state) => state.close);
  const inputRef = useRef<TextInput | null>(null);

  const isDesktop = !isNative && getIsElectronRuntime();

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const onKeyPress = useCallback(
    (event: WebTextInputKeyPressEvent) => {
      const { key } = event.nativeEvent;
      if (key === "Escape") {
        close();
        return;
      }
      if (key === "Enter") {
        if (event.nativeEvent.shiftKey === true) {
          findPrevious();
        } else {
          findNext();
        }
      }
    },
    [close, findNext, findPrevious],
  );

  if (!isDesktop || !isOpen) {
    return null;
  }

  const hasQuery = query.length > 0;
  const noMatches = hasQuery && matches === 0;
  const counter = hasQuery
    ? t("find.counter", { active: activeIndex >= 0 ? activeIndex + 1 : 0, total: matches })
    : "";

  return (
    <View style={styles.container} dataSet={FIND_BAR_DATASET}>
      <View style={styles.bar}>
        <ThemedTextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onKeyPress={onKeyPress}
          placeholder={t("find.placeholder")}
          accessibilityLabel={t("find.placeholder")}
          style={styles.input}
          testID="find-bar-input"
          autoCorrect={false}
          spellCheck={false}
        />
        <Text style={[styles.counter, noMatches && styles.counterEmpty]}>{counter}</Text>
        <Pressable
          onPress={findPrevious}
          style={styles.iconButton}
          accessibilityLabel={t("find.previous")}
          testID="find-bar-previous"
        >
          <ThemedChevronUp size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </Pressable>
        <Pressable
          onPress={findNext}
          style={styles.iconButton}
          accessibilityLabel={t("find.next")}
          testID="find-bar-next"
        >
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </Pressable>
        <Pressable
          onPress={close}
          style={styles.iconButton}
          accessibilityLabel={t("find.close")}
          testID="find-bar-close"
        >
          <ThemedX size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[3],
    zIndex: 200,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  input: {
    minWidth: 180,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[0.5],
    paddingHorizontal: theme.spacing[1],
  },
  counter: {
    minWidth: 56,
    textAlign: "right",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  counterEmpty: {
    color: theme.colors.destructive,
  },
  iconButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
}));
