import { normalizeStreamTag } from "@getpaseo/protocol/stream-tags";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { Theme } from "@/styles/theme";
import { suggestTags } from "./tag-model";

const ThemedX = withUnistyles(X);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Chosen tags as chips plus an input that commits on space, comma or return, offering existing
 * tags as you type. The caller appends the tags to the saved text as #hashtags.
 */
export const TagField = memo(function TagField({
  value,
  onChange,
  known,
  disabled = false,
  testID = "stream-tag-field",
}: {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  known: readonly string[];
  disabled?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const input = useRef<EditingTextInputHandle>(null);
  const [draft, setDraft] = useState("");
  // Always visible (not focus-gated): on web the input blurs before a suggestion's press lands.
  const suggestions = useMemo(() => suggestTags(known, draft, value), [known, draft, value]);
  const add = useCallback(
    (raw: string) => {
      const tag = normalizeStreamTag(raw);
      if (tag && !value.includes(tag)) onChange([...value, tag]);
      setDraft("");
      input.current?.replaceText("");
    },
    [value, onChange],
  );
  const changeText = useCallback(
    (text: string) => {
      // A separator commits the word before it; the rest stays as the draft.
      const parts = text.split(/[\s,]+/);
      if (parts.length > 1) {
        const rest = parts.pop() ?? "";
        const next = [...value];
        for (const part of parts) {
          const tag = normalizeStreamTag(part);
          if (tag && !next.includes(tag)) next.push(tag);
        }
        if (next.length !== value.length) onChange(next);
        setDraft(rest);
        input.current?.replaceText(rest);
        return;
      }
      setDraft(text);
    },
    [value, onChange],
  );
  const submit = useCallback(() => add(draft), [add, draft]);
  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.field}>
        {value.map((tag) => (
          <ChosenTag key={tag} tag={tag} value={value} onChange={onChange} disabled={disabled} />
        ))}
        <AdaptiveTextInput
          ref={input}
          style={styles.input}
          initialValue=""
          placeholder={value.length ? "" : t("agentPanel.stream.tags.fieldPlaceholder")}
          accessibilityLabel={t("agentPanel.stream.tags.field")}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          onChangeText={changeText}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          testID={`${testID}-input`}
        />
      </View>
      {suggestions.length ? (
        <View style={styles.suggestions}>
          {suggestions.map((tag) => (
            <Suggestion key={tag} tag={tag} onAdd={add} disabled={disabled} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

function ChosenTag({
  tag,
  value,
  onChange,
  disabled,
}: {
  tag: string;
  value: readonly string[];
  onChange: (tags: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const remove = useCallback(
    () => onChange(value.filter((item) => item !== tag)),
    [onChange, value, tag],
  );
  return (
    <View style={styles.chosen}>
      <Text style={styles.chosenText}>#{tag}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("agentPanel.stream.tags.removeTag", { tag })}
        onPress={remove}
        disabled={disabled}
        hitSlop={8}
      >
        <ThemedX size={12} uniProps={mutedIcon} />
      </Pressable>
    </View>
  );
}

function Suggestion({
  tag,
  onAdd,
  disabled,
}: {
  tag: string;
  onAdd: (tag: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const add = useCallback(() => onAdd(tag), [onAdd, tag]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("agentPanel.stream.tags.add", { tag })}
      onPress={add}
      disabled={disabled}
      style={suggestionStyle}
      testID={`stream-tag-suggestion-${tag}`}
    >
      <Text style={styles.suggestionText}>#{tag}</Text>
    </Pressable>
  );
}

function suggestionStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.suggestion, (hovered || pressed) && styles.hovered];
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.spacing[1] },
  field: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 36,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
  },
  input: {
    flexGrow: 1,
    minWidth: 96,
    paddingVertical: theme.spacing[1],
    fontSize: theme.fontSize.sm,
  },
  chosen: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    minHeight: 24,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
  },
  chosenText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  suggestion: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  hovered: { backgroundColor: theme.colors.surface2 },
  suggestionText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
