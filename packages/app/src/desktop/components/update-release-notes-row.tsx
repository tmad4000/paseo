import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ArrowUpRight } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { formatUpdateWhatsNew, type UpdateIdentity } from "@/desktop/updates/update-identity";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";

const ThemedArrowUpRight = withUnistyles(ArrowUpRight);
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Settings row linking the feed's release page for the version the updates row names. */
export function UpdateReleaseNotesRow({ identity }: { identity: UpdateIdentity }) {
  const { releaseNotesUrl } = identity;
  const open = useCallback(() => {
    if (releaseNotesUrl) void openExternalUrl(releaseNotesUrl);
  }, [releaseNotesUrl]);
  if (!releaseNotesUrl) return null;
  return (
    <Pressable
      style={[settingsStyles.row, settingsStyles.rowBorder]}
      onPress={open}
      accessibilityRole="link"
      testID="settings-update-release-notes"
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
        <>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{formatUpdateWhatsNew(identity)}</Text>
            <Text style={settingsStyles.rowHint}>{releaseNotesUrl.replace(/^https:\/\//, "")}</Text>
          </View>
          <ThemedArrowUpRight
            size={ICON_SIZE.sm}
            uniProps={hovered ? foregroundMapping : foregroundMutedMapping}
          />
        </>
      )}
    </Pressable>
  );
}
