import { useCallback, useMemo } from "react";
import { router, usePathname, type Href } from "expo-router";
import { LayoutPanelLeft, Plus, ListFilter } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useViewsStore } from "@/stores/views-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { buildViewRoute } from "@/utils/host-routes";

const ThemedPlus = withUnistyles(Plus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Sidebar list of cross-workspace Views, above the projects. */
export function SidebarViewsSection() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const order = useViewsStore((state) => state.order);
  const viewsById = useViewsStore((state) => state.views);
  const views = useMemo(
    () =>
      order.flatMap((id) => {
        const view = viewsById[id];
        return view ? [{ id, name: view.name }] : [];
      }),
    [order, viewsById],
  );

  const createView = useCallback(() => {
    const viewId = useViewsStore.getState().createView();
    router.push(buildViewRoute(viewId) as Href);
  }, []);

  const openStream = useCallback(() => router.navigate("/stream" as Href), []);

  return (
    <View style={styles.section} testID="sidebar-views-section">
      <SidebarHeaderRow
        variant="compact"
        icon={ListFilter}
        label={t("globalStream.title")}
        isActive={pathname === "/stream"}
        onPress={openStream}
        testID="sidebar-global-stream"
      />
      <View style={styles.header}>
        <Text style={styles.title}>{t("views.sidebar.title")}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("views.sidebar.newView")}
          onPress={createView}
          testID="sidebar-new-view"
          style={addButtonStyle}
        >
          <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </Pressable>
      </View>
      {views.map((view) => (
        <SidebarViewRow
          key={view.id}
          viewId={view.id}
          name={view.name}
          isActive={pathname === buildViewRoute(view.id)}
        />
      ))}
    </View>
  );
}

function SidebarViewRow({
  viewId,
  name,
  isActive,
}: {
  viewId: string;
  name: string;
  isActive: boolean;
}) {
  const openView = useCallback(() => router.push(buildViewRoute(viewId) as Href), [viewId]);
  return (
    <SidebarHeaderRow
      variant="compact"
      icon={LayoutPanelLeft}
      label={name}
      isActive={isActive}
      onPress={openView}
      testID={`sidebar-view-${viewId}`}
    />
  );
}

function addButtonStyle({ hovered }: { hovered?: boolean }) {
  return [styles.addButton, hovered ? styles.addButtonHovered : null];
}

const styles = StyleSheet.create((theme) => ({
  section: {
    paddingBottom: theme.spacing[1],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: 4,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  addButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  addButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
}));
