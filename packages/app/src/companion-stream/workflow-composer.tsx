import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import { useHostRuntimeClient, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { StreamNoteComposer, type ComposerMode } from "./note-composer";
import type { WorkflowScope } from "./global-screen";
import type { WorkflowView } from "./workflow-view";

const COMPOSERS = ["tasks", "questions", "saved", "needs_you"] as const;
type WritableView = (typeof COMPOSERS)[number];
const MODES: Record<WritableView, ComposerMode> = {
  tasks: "checklist",
  questions: "stream",
  saved: "pinned",
  needs_you: "stream",
};
const PLACEHOLDERS: Record<WritableView, string> = {
  tasks: "agentPanel.stream.askPlaceholder",
  questions: "globalStream.userQuestionPlaceholder",
  saved: "agentPanel.stream.notePlaceholder",
  needs_you: "globalStream.inputPlaceholder",
};
const SUBMITS: Record<WritableView, string> = {
  tasks: "agentPanel.stream.addAsk",
  questions: "globalStream.addQuestion",
  saved: "agentPanel.stream.addNote",
  needs_you: "globalStream.addInput",
};

/** Keep each local draft mounted across filters; writing always names the explicit source chat. */
export function WorkflowComposer({
  scope,
  view,
  visible,
  supportsTags,
  knownTags,
  onSaved,
}: {
  scope: WorkflowScope;
  view: WorkflowView;
  visible: boolean;
  supportsTags: boolean;
  knownTags: readonly string[];
  onSaved: () => void;
}) {
  return (
    <View>
      {COMPOSERS.map((mode) => (
        <View key={mode} style={visible && mode === view ? undefined : styles.hidden}>
          <WorkflowDraft
            scope={scope}
            view={mode}
            supportsTags={supportsTags}
            knownTags={knownTags}
            onSaved={onSaved}
          />
        </View>
      ))}
    </View>
  );
}
function WorkflowDraft({
  scope,
  view,
  supportsTags,
  knownTags,
  onSaved,
}: {
  scope: WorkflowScope;
  view: WritableView;
  supportsTags: boolean;
  knownTags: readonly string[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(scope.serverId);
  const connection = useHostRuntimeConnectionStatus(scope.serverId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = useCallback(
    async ({ entryId, text }: { entryId: string; text: string }) => {
      setSaving(true);
      setError(null);
      try {
        if (!client || connection !== "online") throw new Error(t("globalStream.writeUnavailable"));
        let update: StreamEntryUpdate;
        if (view === "tasks")
          update = {
            agentId: scope.agentId,
            entryId,
            text,
            action: "set_ask",
            expectedRevision: 0,
            ask: { state: "open", remaining: "", evidence: "" },
          };
        else if (view === "questions")
          update = {
            agentId: scope.agentId,
            entryId,
            text,
            action: "set_ask",
            expectedRevision: 0,
            ask: { state: "open", remaining: "", evidence: "", expectsAnswer: true },
          };
        else if (view === "needs_you")
          update = {
            agentId: scope.agentId,
            entryId,
            text,
            action: "add_question",
            inputRequest: { kind: "input", recipient: "user" },
          };
        else update = { agentId: scope.agentId, entryId, text, action: "add_pin" };
        await client.updateStreamEntry(update);
        onSaved();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t("globalStream.saveFailed"));
        throw failure;
      } finally {
        setSaving(false);
      }
    },
    [client, connection, t, scope.agentId, view, onSaved],
  );
  return (
    <View>
      <StreamNoteComposer
        mode={MODES[view]}
        saving={saving}
        online={connection === "online"}
        supportsTags={supportsTags}
        knownTags={knownTags}
        onSubmit={submit}
        placeholderKey={PLACEHOLDERS[view]}
        submitLabelKey={SUBMITS[view]}
        testID={`stream-${view}-input`}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  hidden: { display: "none" },
  error: { color: theme.colors.statusWarning, fontSize: theme.fontSize.sm },
}));
