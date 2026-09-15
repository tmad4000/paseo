import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getIsElectronRuntime, HEADER_INNER_HEIGHT } from "@/constants/layout";
import { isNative } from "@/constants/platform";

/**
 * Marks this build as the fork so it is never mistaken for a stock Paseo
 * window. The fork installs alongside upstream Paseo — same daemon home, same
 * port — so the window itself has to say which binary is driving it.
 *
 * Rendered once at the app root and pinned to the titlebar strip. It sits above
 * the tab row with pointer events off, so it can never intercept a click meant
 * for the UI underneath.
 */
export function ForkBadge() {
  if (isNative || !getIsElectronRuntime()) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.pill}>
        <Text style={styles.label}>FORK</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: 0,
    right: theme.spacing[3],
    height: HEADER_INNER_HEIGHT,
    justifyContent: "center",
    zIndex: 100,
  },
  pill: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: "#5B21B6",
    borderWidth: theme.borderWidth[1],
    borderColor: "#F59E0B",
  },
  label: {
    color: "#F59E0B",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
}));
