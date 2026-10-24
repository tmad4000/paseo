import { useCallback, useMemo, useState } from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getUserMessagePreview } from "./user-message-preview";

export function CollapsiblePrompt({
  message,
  textStyle,
  dataSet,
  renderFullContent = false,
}: {
  message: string;
  textStyle: StyleProp<TextStyle>;
  dataSet: Record<string, string>;
  renderFullContent?: boolean;
}) {
  const { t } = useTranslation();
  const preview = useMemo(() => getUserMessagePreview(message), [message]);
  // Expansion belongs to this exact text, even when a virtual row is reused.
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);
  const expanded = expandedMessage === message;
  const toggle = useCallback(
    () => setExpandedMessage(expanded ? null : message),
    [expanded, message],
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  return (
    <View>
      <Text selectable style={textStyle} dataSet={dataSet}>
        {expanded || renderFullContent ? message : preview.text}
      </Text>
      {preview.truncated && !renderFullContent ? (
        <Button
          variant="ghost"
          size="sm"
          style={styles.toggle}
          onPress={toggle}
          accessibilityState={accessibilityState}
          testID="user-message-expand"
        >
          {t(expanded ? "message.actions.showLess" : "message.actions.showMore")}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  toggle: { alignSelf: "flex-start", marginTop: theme.spacing[1], minHeight: 44 },
}));
