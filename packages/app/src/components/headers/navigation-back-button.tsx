import { useCallback, useMemo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "./header-toggle-button";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  navigateInFocusHistory,
  useCanNavigateBackInFocusHistory,
  useCanNavigateForwardInFocusHistory,
} from "@/navigation/focus-history-runtime";
import type { NavigationFocusHistoryDirection } from "@/navigation/focus-history";
import type { ShortcutKey } from "@/utils/format-shortcut";
import type { Theme } from "@/styles/theme";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

const DIRECTIONS = {
  back: {
    testID: "navigation-back-button",
    labelKey: "common.actions.navigateBack",
    shortcutKeys: ["mod", "alt", "ArrowLeft"],
    Icon: ThemedArrowLeft,
  },
  forward: {
    testID: "navigation-forward-button",
    labelKey: "common.actions.navigateForward",
    shortcutKeys: ["mod", "alt", "ArrowRight"],
    Icon: ThemedArrowRight,
  },
} as const satisfies Record<
  NavigationFocusHistoryDirection,
  {
    testID: string;
    labelKey: string;
    shortcutKeys: readonly ShortcutKey[];
    Icon: typeof ThemedArrowLeft;
  }
>;

function NavigationHistoryButton({
  direction,
  available,
}: {
  direction: NavigationFocusHistoryDirection;
  available: boolean;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { testID, labelKey, shortcutKeys, Icon } = DIRECTIONS[direction];
  const tooltipKeys = useMemo<ShortcutKey[]>(
    () => (isCompact ? [] : [...shortcutKeys]),
    [isCompact, shortcutKeys],
  );
  const accessibilityState = useMemo(() => ({ disabled: !available }), [available]);
  const handlePress = useCallback(() => {
    navigateInFocusHistory(direction, { isCompact });
  }, [direction, isCompact]);

  return (
    <HeaderToggleButton
      testID={testID}
      onPress={handlePress}
      disabled={!available}
      tooltipLabel={t(labelKey)}
      tooltipKeys={tooltipKeys}
      tooltipSide="bottom"
      accessibilityRole="button"
      accessibilityLabel={t(labelKey)}
      accessibilityState={accessibilityState}
    >
      {({ hovered, pressed }) => {
        let colorMapping = mutedColorMapping;
        if (!available) {
          colorMapping = extraMutedColorMapping;
        } else if (hovered || pressed) {
          colorMapping = foregroundColorMapping;
        }
        return <Icon size={16} uniProps={colorMapping} />;
      }}
    </HeaderToggleButton>
  );
}

export function NavigationBackButton() {
  const canGoBack = useCanNavigateBackInFocusHistory();
  return <NavigationHistoryButton direction="back" available={canGoBack} />;
}

/**
 * Hidden on compact layouts until there is somewhere to go forward to, so the phone
 * header only spends room on it after a Back.
 */
export function NavigationForwardButton() {
  const isCompact = useIsCompactFormFactor();
  const canGoForward = useCanNavigateForwardInFocusHistory();
  if (isCompact && !canGoForward) {
    return null;
  }
  return <NavigationHistoryButton direction="forward" available={canGoForward} />;
}
