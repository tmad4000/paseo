import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks, ListTree } from "lucide-react-native";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { SidePanelMode } from "./model";

/** The shortcut help id, shared by the binding, its tooltips, and the shortcuts dialog. */
export const SUBTHREADS_TOGGLE_SHORTCUT_ID = "subthreads-toggle";

/** Switches the session's one side panel between its subagents and its checklist. */
export function SidePanelModeSwitch({
  mode,
  onModeChange,
}: {
  mode: SidePanelMode;
  onModeChange: (mode: SidePanelMode) => void;
}): ReactElement {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      {
        value: "subagents" as const,
        label: t("sidePanel.subagents"),
        icon: ({ color, size }: { color: string; size: number }) => (
          <ListTree color={color} size={size} />
        ),
        testID: "session-side-panel-mode-subagents",
      },
      {
        value: "checklist" as const,
        label: t("sidePanel.checklist"),
        icon: ({ color, size }: { color: string; size: number }) => (
          <ListChecks color={color} size={size} />
        ),
        testID: "session-side-panel-mode-checklist",
      },
    ],
    [t],
  );
  return (
    <SegmentedControl
      options={options}
      value={mode}
      onValueChange={onModeChange}
      size="xs"
      testID="session-side-panel-mode"
    />
  );
}
