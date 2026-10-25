import { Text, View } from "react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useSharingAvailability } from "./availability";
import { useShareLinks } from "./use-share-links";
import { ManageShares } from "./share-sheet";
export function HostShares({ serverId }: { serverId: string }) {
  const availability = useSharingAvailability(serverId);
  const { t } = useTranslation();
  const { client, status, data, error, refetch } = useShareLinks(
    serverId,
    undefined,
    availability === true,
  );
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  if (availability === null) return null;
  if (!availability) return <Text style={styles.muted}>{t("sharing.updateHost")}</Text>;
  return (
    <View style={styles.section}>
      {client && status === "success" ? (
        <ManageShares client={client} shares={data} refresh={refresh} />
      ) : (
        <Text style={styles.muted}>{error ? String(error) : t("sharing.loading")}</Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  section: { marginTop: theme.spacing[6] },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
