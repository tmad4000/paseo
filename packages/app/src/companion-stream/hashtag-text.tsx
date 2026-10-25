import { segmentStreamHashtags } from "@getpaseo/protocol/stream-tags";
import { useMemo } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

/** Entry text whose #hashtags are tappable and set the Stream tag filter. */
export function HashtagText({
  text,
  style,
  numberOfLines,
  onTagPress,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  onTagPress?: (tag: string) => void;
}) {
  const { t } = useTranslation();
  const segments = useMemo(
    () => (onTagPress ? segmentStreamHashtags(text) : [{ text }]),
    [text, onTagPress],
  );
  return (
    <Text selectable style={style} numberOfLines={numberOfLines}>
      {segments.map((segment, index) =>
        segment.tag && onTagPress ? (
          <Text
            // Segments are positional slices of one string; index is their identity.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            accessibilityRole="link"
            accessibilityHint={t("agentPanel.stream.tags.filterHint")}
            // eslint-disable-next-line react-perf/jsx-no-new-function-as-prop
            onPress={() => onTagPress(segment.tag!)}
            style={styles.tag}
            testID={`stream-hashtag-${segment.tag}`}
          >
            {segment.text}
          </Text>
        ) : (
          segment.text
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  tag: { color: theme.colors.accent, fontWeight: theme.fontWeight.medium },
}));
