import { useCallback } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FileMarkdownPreview } from "@/file-pane/markdown-preview";
import { resolveMarkdownDocumentLink } from "./model";

export type BrowserMarkdownMode = "preview" | "source";

export function BrowserMarkdownModeBar({
  mode,
  onModeChange,
}: {
  mode: BrowserMarkdownMode;
  onModeChange: (mode: BrowserMarkdownMode) => void;
}) {
  const { t } = useTranslation();
  const options = [
    {
      value: "preview" as const,
      label: t("panels.file.editor.preview"),
      testID: "browser-markdown-mode-preview",
    },
    {
      value: "source" as const,
      label: t("panels.file.editor.source"),
      testID: "browser-markdown-mode-source",
    },
  ];
  return (
    <PaneContentToolbar testID="browser-markdown-bar">
      <View style={styles.barRow}>
        <SegmentedControl
          size="xs"
          value={mode}
          onValueChange={onModeChange}
          testID="browser-markdown-mode"
          options={options}
        />
      </View>
    </PaneContentToolbar>
  );
}

export function BrowserMarkdownDocument({
  source,
  documentUrl,
  onNavigate,
}: {
  source: string;
  documentUrl: string;
  onNavigate: (url: string) => void;
}) {
  const handleLinkPress = useCallback(
    (href: string) => {
      const target = resolveMarkdownDocumentLink(href, documentUrl);
      if (target) onNavigate(target);
      return false;
    },
    [documentUrl, onNavigate],
  );

  return (
    <ScrollView style={styles.document} testID="browser-markdown-document">
      <FileMarkdownPreview source={source} onLinkPress={handleLinkPress} />
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  barRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  document: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surface0,
  },
}));
