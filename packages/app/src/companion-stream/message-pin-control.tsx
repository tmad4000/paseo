import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { BookmarkPlus, Check } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { isWeb } from "@/constants/platform";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import { getMessageSelection } from "./message-selection";
import {
  MessageSaveAttempt,
  messagePinErrorMessage,
  type MessageSaveContent,
  type MessagePinHandler,
} from "./message-pin-operations";
import { appendStreamTags } from "@getpaseo/protocol/stream-tags";
import { useStreamTagSuggestions } from "./stream-tag-scope";
import { TagField } from "./tag-field";

const ThemedBookmark = withUnistyles(BookmarkPlus);
const ThemedCheck = withUnistyles(Check);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const MessagePinControl = memo(function MessagePinControl({
  getContent,
  resolveSaveContent,
  getFinalMessage,
  onPin,
  sourceId,
  containerStyle,
  onActivityChange,
  children,
  scope = "message",
}: {
  scope?: "message" | "response";
  getContent: () => string;
  resolveSaveContent?: () => MessageSaveContent;
  getFinalMessage?: () => MessageSaveContent;
  onPin?: MessagePinHandler;
  sourceId?: string;
  containerStyle?: StyleProp<ViewStyle>;
  onActivityChange?: (active: boolean) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const triggerRef = useRef<View | null>(null);
  const messageAttempt = useRef(new MessageSaveAttempt());
  const [draftStreaming, setDraftStreaming] = useState(false);
  const [draftSourceId, setDraftSourceId] = useState<string | undefined>(sourceId);
  const [selection, setSelection] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<SaveAction | null>(null);
  const saving = savingAction !== null;
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const tagSuggestions = useStreamTagSuggestions(draft !== null);
  useEffect(() => {
    onActivityChange?.(open || draft !== null || saving || saved || error !== null);
  }, [open, draft, saving, saved, error, onActivityChange]);
  const header = useMemo(() => ({ title: t("agentPanel.stream.pinExcerpt") }), [t]);
  const save = useCallback(
    async (text: string, savedSourceId = sourceId, action: SaveAction = "message") => {
      setSavingAction(action);
      setError(null);
      setSaved(false);
      try {
        if (!onPin) return;
        await onPin(text.trim(), savedSourceId);
        messageAttempt.current.clear();
        setSaved(true);
        setDraft(null);
        setTags([]);
        setOpen(false);
      } catch (failure) {
        setError(messagePinErrorMessage(failure, t("globalStream.saveFailed")));
      } finally {
        setSavingAction(null);
      }
    },
    [onPin, sourceId, t],
  );
  const readSaveContent = useCallback(() => {
    const content = resolveSaveContent?.() ?? { text: getContent(), streaming: false };
    return { ...content, sourceId: content.sourceId ?? sourceId };
  }, [getContent, resolveSaveContent, sourceId]);
  const saveResolvedContent = useCallback(
    (content: MessageSaveContent, action: SaveAction = "message") => {
      if (content.streaming || content.text.length > 4000) {
        setDraft(content.text);
        setDraftStreaming(content.streaming);
        setDraftSourceId(content.sourceId ?? sourceId);
        messageAttempt.current.clear();
        setOpen(false);
        return;
      }
      void save(content.text, content.sourceId ?? sourceId, action);
    },
    [save, sourceId],
  );
  const pinMessage = useCallback(() => {
    saveResolvedContent(messageAttempt.current.resolve(readSaveContent));
  }, [readSaveContent, saveResolvedContent]);
  const pinFinalMessage = useCallback(() => {
    if (!getFinalMessage) return;
    try {
      saveResolvedContent(messageAttempt.current.resolve(getFinalMessage, "final"), "final");
    } catch (failure) {
      setError(messagePinErrorMessage(failure, t("globalStream.saveFailed")));
    }
  }, [getFinalMessage, saveResolvedContent, t]);
  const chooseExcerpt = useCallback(() => {
    const content = readSaveContent();
    messageAttempt.current.clear();
    setError(null);
    setDraft(selection ?? content.text);
    setDraftStreaming(!selection && content.streaming);
    setDraftSourceId(content.sourceId ?? sourceId);
    setOpen(false);
  }, [readSaveContent, selection, sourceId]);
  const closeExcerpt = useCallback(() => {
    if (!saving) {
      messageAttempt.current.clear();
      setDraft(null);
    }
  }, [saving]);
  const changeOpen = useCallback(
    (next: boolean) => {
      if (saving) return;
      if (next) setSelection(getMessageSelection(triggerRef.current));
      else messageAttempt.current.clear();
      setOpen(next);
    },
    [saving],
  );

  const saveSelection = useCallback(() => {
    if (selection) void save(selection, sourceId, "selection");
  }, [save, selection, sourceId]);
  const draftWithTags = draft === null ? null : appendStreamTags(draft.trim(), tags);
  const saveDraft = useCallback(() => {
    if (draftWithTags !== null) void save(draftWithTags, draftSourceId, "draft");
  }, [save, draftWithTags, draftSourceId]);

  const Item = children ? ContextMenuItem : DropdownMenuItem;
  const menuItems = (
    <>
      {selection ? (
        <Item
          disabled={saving}
          closeOnSelect={false}
          onSelect={saveSelection}
          status={saveActionStatus(savingAction, "selection")}
        >
          {t("agentPanel.stream.pinSelection")}
        </Item>
      ) : null}
      {getFinalMessage ? (
        <Item
          disabled={saving}
          closeOnSelect={false}
          onSelect={pinFinalMessage}
          status={saveActionStatus(savingAction, "final")}
        >
          {t("agentPanel.stream.pinFinalMessage")}
        </Item>
      ) : null}
      <Item
        disabled={saving}
        closeOnSelect={false}
        status={saveActionStatus(savingAction, "message")}
        onSelect={pinMessage}
      >
        {t(messageSaveLabelKey(scope))}
      </Item>
      <Item disabled={saving} onSelect={chooseExcerpt}>
        {t("agentPanel.stream.pinExcerpt")}
      </Item>
    </>
  );

  if (!onPin) return children;

  return (
    <>
      {children ? (
        <ContextMenu open={open} onOpenChange={changeOpen}>
          <ContextMenuTrigger contextOnly={isWeb} triggerRef={triggerRef}>
            {children}
          </ContextMenuTrigger>
          <ContextMenuContent>{menuItems}</ContextMenuContent>
        </ContextMenu>
      ) : (
        <DropdownMenu open={open} onOpenChange={changeOpen}>
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={t("agentPanel.stream.pinToStream")}
            disabled={saving}
            style={[styles.trigger, containerStyle]}
            hitSlop={8}
          >
            {saved ? (
              <ThemedCheck size={16} uniProps={iconColor} />
            ) : (
              <ThemedBookmark size={16} uniProps={iconColor} />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent>{menuItems}</DropdownMenuContent>
        </DropdownMenu>
      )}
      {saved ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {t("agentPanel.stream.pinSaved")}
        </Text>
      ) : null}
      {error && draft === null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {draft !== null ? (
        <AdaptiveModalSheet
          visible
          onClose={closeExcerpt}
          header={header}
          testID="message-pin-excerpt-sheet"
        >
          <View style={styles.body} testID="message-pin-excerpt-body">
            <Text style={styles.hint}>{t("agentPanel.stream.pinExcerptHint")}</Text>
            <StreamingSaveHint visible={draftStreaming} />
            <AdaptiveTextInput
              initialValue={draft}
              onChangeText={setDraft}
              multiline
              editable={!saving}
              accessibilityLabel={t("agentPanel.stream.pinExcerpt")}
              testID="message-pin-excerpt-input"
              style={styles.input}
            />
            {tagSuggestions.supported ? (
              <TagField
                value={tags}
                onChange={setTags}
                known={tagSuggestions.tags}
                disabled={saving}
                testID="message-pin-excerpt-tags"
              />
            ) : null}
            <Text style={styles.hint}>{(draftWithTags ?? draft).length} / 4000</Text>
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Button variant="secondary" onPress={closeExcerpt} disabled={saving}>
                {t("common.actions.cancel")}
              </Button>
              <Button
                loading={saving}
                disabled={saving || !draft.trim() || (draftWithTags ?? draft).trim().length > 4000}
                onPress={saveDraft}
              >
                {t("agentPanel.stream.pinToStream")}
              </Button>
            </View>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
});

type SaveAction = "message" | "final" | "selection" | "draft";

function saveActionStatus(active: SaveAction | null, expected: SaveAction) {
  return active === expected ? "pending" : undefined;
}

function messageSaveLabelKey(scope: "message" | "response") {
  return scope === "response" ? "agentPanel.stream.pinResponse" : "agentPanel.stream.pinMessage";
}

function StreamingSaveHint({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <Text style={styles.hint} testID="message-pin-streaming-hint">
      {t("agentPanel.stream.pinStreamingHint")}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[2],
    alignSelf: "flex-start",
    borderRadius: theme.borderRadius.sm,
  },
  body: { gap: theme.spacing[3] },
  input: {
    minHeight: 120,
    maxHeight: 280,
    textAlignVertical: "top",
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  status: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));

export const MessagePinItem = memo(function MessagePinItem({
  text,
  resolveSaveContent,
  onPin,
  sourceId,
  children,
}: {
  text: string;
  resolveSaveContent?: (sourceId: string) => MessageSaveContent | undefined;
  onPin?: MessagePinHandler;
  sourceId: string;
  children: ReactNode;
}) {
  const getContent = useCallback(() => text, [text]);
  const resolveMessageContent = useCallback(
    () => resolveSaveContent?.(sourceId) ?? { text, streaming: false },
    [resolveSaveContent, sourceId, text],
  );
  return (
    <MessagePinControl
      getContent={getContent}
      resolveSaveContent={resolveMessageContent}
      onPin={onPin}
      sourceId={sourceId}
    >
      {children}
    </MessagePinControl>
  );
});
