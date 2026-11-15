import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MoreHorizontal } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import type { SendBehavior } from "./state";
import { resolveAlternateSendOverflow, type ComposerOverflowItem } from "./overflow";

const EMPTY_ITEMS: readonly ComposerOverflowItem[] = [];

/** The toolbar's own overflow actions, ahead of whatever the host composer collapses into it. */
export function useComposerToolbarOverflowItems(input: {
  collapseToOverflow: boolean;
  isAgentRunning: boolean;
  canQueue: boolean;
  defaultSendBehavior: SendBehavior;
  hasText: boolean;
  attachmentCount: number;
  isSendDisabled: boolean;
  onAlternateSend: () => void;
  overflowItems: readonly ComposerOverflowItem[];
}): readonly ComposerOverflowItem[] {
  const { t } = useTranslation();
  const { collapseToOverflow, onAlternateSend, overflowItems } = input;
  const alternateSend = resolveAlternateSendOverflow({
    enabled: collapseToOverflow,
    isAgentRunning: input.isAgentRunning,
    canQueue: input.canQueue,
    defaultSendBehavior: input.defaultSendBehavior,
    // Queueing takes text or attachments only, never external content alone.
    hasSendableContent: input.hasText || input.attachmentCount > 0,
    isSendDisabled: input.isSendDisabled,
  });
  const alternateSendLabel = alternateSend ? t(alternateSend.labelKey) : null;
  const alternateSendDisabled = alternateSend?.disabled ?? true;
  return useMemo(() => {
    if (!collapseToOverflow) return EMPTY_ITEMS;
    if (alternateSendLabel === null) return overflowItems;
    return [
      {
        id: "alternate-send",
        label: alternateSendLabel,
        disabled: alternateSendDisabled,
        onSelect: onAlternateSend,
      },
      ...overflowItems,
    ];
  }, [
    alternateSendDisabled,
    alternateSendLabel,
    collapseToOverflow,
    onAlternateSend,
    overflowItems,
  ]);
}

const WEB_TRIGGER_ARIA = isWeb ? ({ "aria-haspopup": "menu" } as const) : null;

export function ComposerOverflowMenu({
  items,
  label,
  disabled,
  buttonIconSize,
}: {
  items: readonly ComposerOverflowItem[];
  label: string;
  disabled: boolean;
  buttonIconSize: number;
}) {
  const triggerStyle = useCallback(
    ({ hovered, open }: { hovered?: boolean; open?: boolean }) => [
      styles.trigger,
      (Boolean(hovered) || Boolean(open)) && styles.triggerHovered,
      disabled && styles.triggerDisabled,
    ],
    [disabled],
  );
  const renderIcon = useCallback(
    ({ hovered, open }: { hovered?: boolean; open?: boolean }) => (
      <ThemedMoreHorizontal
        size={buttonIconSize}
        uniProps={Boolean(hovered) || Boolean(open) ? foregroundMapping : foregroundMutedMapping}
      />
    ),
    [buttonIconSize],
  );

  if (items.length === 0) return null;

  return (
    <DropdownMenu compactMode="sheet">
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            {...WEB_TRIGGER_ARIA}
            disabled={disabled}
            accessibilityLabel={label}
            accessibilityRole="button"
            testID="message-input-overflow-button"
            style={triggerStyle}
          >
            {renderIcon}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{label}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="end"
        offset={8}
        minWidth={200}
        testID="message-input-overflow-menu"
        sheetTitle={label}
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            testID={`message-input-overflow-item-${item.id}`}
            disabled={item.disabled}
            onSelect={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme: Theme) => ({
  trigger: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
