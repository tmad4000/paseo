import { Text, View } from "react-native";
import { Columns2, Rows2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { TabLocalChip } from "@/tab-local-splits/use-tab-local-pane";

const ThemedColumns2 = withUnistyles(Columns2);
const ThemedRows2 = withUnistyles(Rows2);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const GLYPH_SIZE = 12;
const GLYPH_GAP = 2;
const COUNT_DIGIT_WIDTH = 7;
/** The gap the chip's content row puts before the glyph. */
const LEADING_GAP = 4;

/** Width the strip reserves after a composite host's title, so the label truncates before it. */
export function tabLocalChipGlyphWidth(leafCount: number): number {
  if (leafCount <= 0) return 0;
  return LEADING_GAP + GLYPH_SIZE + GLYPH_GAP + String(leafCount).length * COUNT_DIGIT_WIDTH;
}

/** `columns-2`/`rows-2` and the leaf count after a composite host's title. */
export function TabLocalChipGlyph({ chip, testID }: { chip: TabLocalChip; testID?: string }) {
  return (
    <View style={styles.glyph} testID={testID} accessibilityLabel={chip.summary}>
      {chip.direction === "horizontal" ? (
        <ThemedColumns2 size={GLYPH_SIZE} uniProps={mutedColorMapping} />
      ) : (
        <ThemedRows2 size={GLYPH_SIZE} uniProps={mutedColorMapping} />
      )}
      <Text style={styles.count} selectable={false}>
        {chip.leafCount}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  glyph: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: GLYPH_GAP,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
    userSelect: "none",
  },
}));
