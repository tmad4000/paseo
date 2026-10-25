import { useCallback, useMemo, type ReactElement } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { ListChecks, ListTree } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSubthreadsHost } from "./context";
import { buildSubthreadsSummaryLabel } from "./drawer";

/**
 * Opens the pane's subagents drawer. Rendered beside the Chat / Stream controls; absent when
 * the agent has no subagents or its pane hosts no drawer (a subagent shown inside one).
 */
export function SubthreadsOpenButton(): ReactElement | null {
  const { t } = useTranslation();
  const host = useSubthreadsHost();
  const compact = useIsCompactFormFactor();
  const expanded = Boolean(host?.isOpen && host.mode === "subagents");
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const needsInput = host?.summary.needsInput ?? 0;
  const total = host?.summary.total ?? 0;
  const trailingElement = useMemo(
    () => <SubthreadsCount needsInput={needsInput} total={total} />,
    [needsInput, total],
  );
  const handlePress = useCallback(() => {
    if (!host) return;
    if (host.isOpen && host.mode === "subagents") host.close();
    else host.open();
  }, [host]);
  if (!host || host.summary.total === 0) return null;
  const { summary } = host;
  const summaryLabel = buildSubthreadsSummaryLabel(t, summary);
  return (
    <Button
      variant="ghost"
      size={compact ? "md" : "sm"}
      style={compact ? styles.compactButton : undefined}
      leftIcon={ListTree}
      trailing={trailingElement}
      accessibilityLabel={t("subthreads.openButtonLabel", { summary: summaryLabel })}
      accessibilityState={accessibilityState}
      testID="subthreads-open"
      onPress={handlePress}
    >
      {t("subthreads.openButton")}
    </Button>
  );
}

/**
 * Shows the session's linked checklist beside the chat. Present only once a checklist page has
 * been linked to the session (an agent or the CLI sets `paseo.checklist-url`).
 */
export function SessionChecklistButton(): ReactElement | null {
  const { t } = useTranslation();
  const host = useSubthreadsHost();
  const compact = useIsCompactFormFactor();
  const expanded = Boolean(host?.isOpen && host.mode === "checklist");
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const handlePress = useCallback(() => {
    if (!host) return;
    if (expanded) host.close();
    else host.openChecklist();
  }, [expanded, host]);
  if (!host?.hasChecklistLink) return null;
  return (
    <Button
      variant="ghost"
      size={compact ? "md" : "sm"}
      style={compact ? styles.compactButton : undefined}
      leftIcon={ListChecks}
      accessibilityLabel={t("sidePanel.toggleChecklist")}
      accessibilityState={accessibilityState}
      testID="session-checklist-open"
      onPress={handlePress}
    >
      {t("sidePanel.checklist")}
    </Button>
  );
}

function SubthreadsCount({ needsInput, total }: { needsInput: number; total: number }) {
  if (needsInput > 0) return <StatusBadge label={String(needsInput)} variant="warning" />;
  return <Text style={styles.count}>{total}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  compactButton: { minHeight: 44 },
  count: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
}));
