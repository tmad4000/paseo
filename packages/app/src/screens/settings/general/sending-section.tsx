import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { useAppSettings, type SendBehavior, type AppSettings } from "@/hooks/use-settings";

const SEND_BEHAVIORS: readonly SendBehavior[] = ["interrupt", "steer", "queue"];

export function SendingSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const options = useMemo(
    () =>
      SEND_BEHAVIORS.map((value) => ({
        value,
        label: t(`settings.general.defaultSend.options.${value}`),
      })),
    [t],
  );
  const change = useCallback(
    (sendBehavior: SendBehavior) => void updateSettings({ sendBehavior }),
    [updateSettings],
  );
  const changeRouting = useCallback(
    (sessionRoutingProvider: AppSettings["sessionRoutingProvider"]) =>
      void updateSettings({ sessionRoutingProvider }),
    [updateSettings],
  );
  const changeLiveRouting = useCallback(
    (liveRoutingSuggestions: boolean) => void updateSettings({ liveRoutingSuggestions }),
    [updateSettings],
  );
  return (
    <SettingsSection title={t("settings.general.sending")}>
      <SettingsCard>
        <SettingsSelect
          label={t("settings.general.defaultSend.label")}
          hint={t(`settings.general.defaultSend.descriptions.${settings.sendBehavior}`)}
          value={settings.sendBehavior}
          options={options}
          onValueChange={change}
        />
        <SettingsSelect
          label="Chat routing"
          hint="Experimental matcher for Filter projects. Jev falls back to OpenAI Decisions, then Current LLM."
          value={settings.sessionRoutingProvider}
          options={[
            { value: "codex", label: "Current LLM" },
            { value: "jev", label: "Jev" },
            { value: "openai-decisions", label: "OpenAI Decisions" },
          ]}
          onValueChange={changeRouting}
        />
        <SettingsSwitch
          label="Live routing suggestions"
          hint="Find chats while typing or dictating. Suggestions never send. Available with Jev or OpenAI Decisions."
          value={settings.liveRoutingSuggestions}
          disabled={settings.sessionRoutingProvider === "codex"}
          onValueChange={changeLiveRouting}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
