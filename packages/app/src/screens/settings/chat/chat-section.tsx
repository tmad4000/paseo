import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { isNative } from "@/constants/platform";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";

const TOOL_CALL_DETAIL_LEVELS: readonly AppSettings["toolCallDetailLevel"][] = [
  "overview",
  "quiet",
  "detailed",
];

export function ChatSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();

  const toolCallDetailOptions = useMemo(
    () =>
      TOOL_CALL_DETAIL_LEVELS.map((value) => ({
        value,
        label: t(`settings.general.toolCallDetail.options.${value}`),
      })),
    [t],
  );

  const changeToolCallDetailLevel = useCallback(
    (toolCallDetailLevel: AppSettings["toolCallDetailLevel"]) =>
      void updateSettings({ toolCallDetailLevel }),
    [updateSettings],
  );
  const changeAutoExpandReasoning = useCallback(
    (autoExpandReasoning: boolean) => void updateSettings({ autoExpandReasoning }),
    [updateSettings],
  );
  const changeMarkReadOnOpen = useCallback(
    (markReadOnOpen: boolean) => void updateSettings({ markReadOnOpen }),
    [updateSettings],
  );
  const changeChatOutline = useCallback(
    (chatOutlineEnabled: boolean) => void updateSettings({ chatOutlineEnabled }),
    [updateSettings],
  );

  return (
    <View>
      <SettingsSection title={t("settings.appearance.detailLevel.title")}>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.general.autoExpandReasoning.label")}
            hint={t("settings.general.autoExpandReasoning.description")}
            value={settings.autoExpandReasoning}
            onValueChange={changeAutoExpandReasoning}
          />
          <SettingsSelect
            label={t("settings.general.toolCallDetail.label")}
            hint={t("settings.general.toolCallDetail.description")}
            value={settings.toolCallDetailLevel}
            options={toolCallDetailOptions}
            onValueChange={changeToolCallDetailLevel}
          />
          {isNative ? null : (
            <SettingsSwitch
              label={t("settings.appearance.chatOutline.title")}
              hint={t("settings.appearance.chatOutline.description")}
              value={settings.chatOutlineEnabled}
              onValueChange={changeChatOutline}
            />
          )}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("settings.general.markReadOnOpen.section")}>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.general.markReadOnOpen.label")}
            hint={t("settings.general.markReadOnOpen.description")}
            value={settings.markReadOnOpen}
            onValueChange={changeMarkReadOnOpen}
            testID="settings-mark-read-on-open"
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
