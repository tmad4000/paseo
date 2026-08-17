import { useCallback, useEffect, useRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronDown, ChevronUp, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { getIsElectronRuntime } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { useFindStore, type FindResult } from "@/find/find-store";

const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedX = withUnistyles(X);
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface DesktopFindResultEvent {
  matches?: unknown;
  activeMatchOrdinal?: unknown;
  finalUpdate?: unknown;
}

/**
 * The Cmd+F bar. Chromium owns the actual search and the scroll-into-view, so
 * this is only the control surface: a query field, a match counter, and the
 * step/dismiss affordances.
 *
 * Desktop-only. `findInPage` has no equivalent on native, and on plain web the
 * browser's own Cmd+F is already the right answer.
 */
export function FindBar() {
  const { t } = useTranslation();
  const isOpen = useFindStore((state) => state.isOpen);
  const query = useFindStore((state) => state.query);
  const matches = useFindStore((state) => state.matches);
  const activeMatch = useFindStore((state) => state.activeMatch);
  const setQuery = useFindStore((state) => state.setQuery);
  const findNext = useFindStore((state) => state.findNext);
  const findPrevious = useFindStore((state) => state.findPrevious);
  const close = useFindStore((state) => state.close);
  const applyResult = useFindStore((state) => state.applyResult);
  const inputRef = useRef<TextInput | null>(null);

  const isDesktop = !isNative && getIsElectronRuntime();

  useEffect(() => {
    if (!isDesktop) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const subscribe = async (): Promise<void> => {
      try {
        const dispose = await listenToDesktopEvent<DesktopFindResultEvent>(
          "find-in-page-result",
          (payload) => {
            // Only the final update carries a settled count; intermediate ones
            // make the counter flicker while Chromium is still scanning.
            if (payload.finalUpdate !== true) {
              return;
            }
            const result: FindResult = {
              matches: typeof payload.matches === "number" ? payload.matches : 0,
              activeMatch:
                typeof payload.activeMatchOrdinal === "number" ? payload.activeMatchOrdinal : 0,
            };
            applyResult(result);
          },
        );
        // The effect can be torn down while the subscription is still in
        // flight; dispose immediately rather than leaking the listener.
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      } catch {
        // No desktop event bridge in this runtime; the bar stays countless.
      }
    };
    void subscribe();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isDesktop, applyResult]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const onKeyPress = useCallback(
    (event: { nativeEvent: { key: string; shiftKey?: boolean } }) => {
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
  const counter = hasQuery ? t("find.counter", { active: activeMatch, total: matches }) : "";

  return (
    <View style={styles.container}>
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
        <Text style={[styles.counter, hasQuery && matches === 0 && styles.counterEmpty]}>
          {counter}
        </Text>
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
