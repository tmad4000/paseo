import { memo } from "react";
import { Pressable, View } from "react-native";
import { Check, CheckCheck, CircleAlert, Clock3 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import type { MessageDeliveryState } from "@/composer/delivery-state";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedClock = withUnistyles(Clock3);
const ThemedCheck = withUnistyles(Check);
const ThemedCheckCheck = withUnistyles(CheckCheck);
const ThemedAlert = withUnistyles(CircleAlert);

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const warningMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

export function useDeliveryStateLabel(state: MessageDeliveryState): string {
  const { t } = useTranslation();
  switch (state) {
    case "pending":
      return t("composer.delivery.pending");
    case "accepted":
      return t("composer.delivery.accepted");
    case "delivered":
      return t("composer.delivery.delivered");
    case "attention":
      return t("composer.delivery.attention");
  }
}

function DeliveryIcon({ state }: { state: MessageDeliveryState }) {
  switch (state) {
    case "pending":
      return <ThemedClock size={ICON_SIZE.xs} uniProps={mutedMapping} />;
    case "accepted":
      return <ThemedCheck size={ICON_SIZE.xs} uniProps={mutedMapping} />;
    case "delivered":
      return <ThemedCheckCheck size={ICON_SIZE.xs} uniProps={mutedMapping} />;
    case "attention":
      return <ThemedAlert size={ICON_SIZE.xs} uniProps={warningMapping} />;
  }
}

/**
 * A messaging-app style tick for the user's own message: clock while it is only
 * on this device, one check once the host has it, two once the agent has it, and
 * an alert when it needs the user. See docs/queue-mirroring.md, "Delivery marks".
 */
export const DeliveryMark = memo(function DeliveryMark({
  state,
  onPress,
  testID,
}: {
  state: MessageDeliveryState;
  onPress?: () => void;
  testID?: string;
}) {
  const label = useDeliveryStateLabel(state);
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
        style={styles.mark}
        testID={testID}
      >
        <DeliveryIcon state={state} />
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={label} style={styles.mark} testID={testID}>
      <DeliveryIcon state={state} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  mark: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: ICON_SIZE.xs,
    paddingHorizontal: theme.spacing[1],
  },
}));
