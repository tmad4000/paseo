import { appendStreamTags } from "@getpaseo/protocol/stream-tags";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { TagField } from "./tag-field";

const NoteInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

export type ComposerMode = "checklist" | "stream" | "pinned";

const PLACEHOLDERS: Record<ComposerMode, string> = {
  checklist: "agentPanel.stream.askPlaceholder",
  pinned: "agentPanel.stream.notePlaceholder",
  stream: "globalStream.questionPlaceholder",
};
const SUBMIT_LABELS: Record<ComposerMode, string> = {
  checklist: "agentPanel.stream.addAsk",
  pinned: "agentPanel.stream.addNote",
  stream: "globalStream.addQuestion",
};

/**
 * Per-chat note, question or ask input. Tags (when the host supports them) are appended to the
 * text as #hashtags. One draft keeps one entry ID until it saves, so a retry never duplicates.
 */
export function StreamNoteComposer({
  mode,
  saving,
  online,
  supportsTags,
  knownTags,
  onSubmit,
}: {
  mode: ComposerMode;
  saving: boolean;
  online: boolean;
  supportsTags: boolean;
  knownTags: readonly string[];
  onSubmit: (input: { entryId: string; text: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const input = useRef<EditingTextInputHandle>(null);
  const draftEntryId = useRef<string | null>(null);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const showTags = supportsTags && mode !== "checklist";
  const submit = useCallback(() => {
    if (!text.trim() || saving) return;
    onSubmit({
      entryId: (draftEntryId.current ??= globalThis.crypto.randomUUID()),
      text: showTags ? appendStreamTags(text.trim(), tags) : text.trim(),
    })
      .then(() => {
        draftEntryId.current = null;
        setText("");
        setTags([]);
        input.current?.replaceText("");
        return;
      })
      .catch(() => undefined);
  }, [text, tags, saving, showTags, onSubmit]);
  return (
    <View style={styles.composer}>
      <View style={styles.row}>
        <NoteInput
          ref={input}
          style={styles.input}
          placeholder={t(PLACEHOLDERS[mode])}
          maxLength={4000}
          editable={!saving}
          initialValue=""
          onChangeText={setText}
          onSubmitEditing={submit}
          testID="companion-stream-note-input"
        />
        <Button onPress={submit} disabled={saving || !online || !text.trim()}>
          {t(SUBMIT_LABELS[mode])}
        </Button>
      </View>
      {showTags ? (
        <TagField
          value={tags}
          onChange={setTags}
          known={knownTags}
          disabled={saving}
          testID="companion-stream-note-tags"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  composer: { gap: theme.spacing[2], marginTop: theme.spacing[2] },
  row: { flexDirection: "row", gap: theme.spacing[2] },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
  },
}));
