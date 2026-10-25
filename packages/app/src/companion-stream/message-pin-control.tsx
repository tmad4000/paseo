import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Check, Pin } from "lucide-react-native";
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
import { messagePinErrorMessage, type MessagePinHandler } from "./message-pin-operations";
import { appendStreamTags } from "@getpaseo/protocol/stream-tags";
import { useStreamTagSuggestions } from "./stream-tag-scope";
import { TagField } from "./tag-field";

const ThemedPin = withUnistyles(Pin);
const ThemedCheck = withUnistyles(Check);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const MessagePinControl = memo(function MessagePinControl({
  getContent,
  onPin,
  sourceId,
  containerStyle,
  onActivityChange,
  children,
}: {
  getContent: () => string;
  onPin?: MessagePinHandler;
  sourceId?: string;
  containerStyle?: StyleProp<ViewStyle>;
  onActivityChange?: (active: boolean) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const triggerRef = useRef<View | null>(null);
  const [selection, setSelection] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const tagSuggestions = useStreamTagSuggestions(draft !== null);
  useEffect(() => {
    onActivityChange?.(open || draft !== null || saving || saved || error !== null);
  }, [open, draft, saving, saved, error, onActivityChange]);
  const header = useMemo(() => ({ title: t("agentPanel.stream.pinExcerpt") }), [t]);
  const save = useCallback(
    async (text: string) => {
      setSaving(true);
      setError(null);
      setSaved(false);
      try {
        if (!onPin) return;
        await onPin(text.trim(), sourceId);
        setSaved(true);
        setDraft(null);
        setTags([]);
        setOpen(false);
      } catch (failure) {
        setError(messagePinErrorMessage(failure, t("globalStream.saveFailed")));
      } finally {
        setSaving(false);
      }
    },
    [onPin, sourceId, t],
  );
  const pinMessage = useCallback(() => {
    const text = getContent();
    if (text.length > 4000) {
      setDraft(text);
      setOpen(false);
      return;
    }
    void save(text);
  }, [getContent, save]);
  const chooseExcerpt = useCallback(() => {
    setError(null);
    setDraft(getContent());
    setOpen(false);
  }, [getContent]);
  const closeExcerpt = useCallback(() => {
    if (!saving) setDraft(null);
  }, [saving]);
  const changeOpen = useCallback(
    (next: boolean) => {
      if (saving) return;
      if (next) setSelection(getMessageSelection(triggerRef.current));
      setOpen(next);
    },
    [saving],
  );

  const saveSelection = useCallback(() => {
    if (selection) void save(selection);
  }, [save, selection]);
  const draftWithTags = draft === null ? null : appendStreamTags(draft.trim(), tags);
  const saveDraft = useCallback(() => {
    if (draftWithTags !== null) void save(draftWithTags);
  }, [save, draftWithTags]);

  const Item = children ? ContextMenuItem : DropdownMenuItem;
  const menuItems = (
    <>
      {selection ? (
        <Item disabled={saving} closeOnSelect={false} onSelect={saveSelection}>
          {t("agentPanel.stream.pinSelection")}
        </Item>
      ) : null}
      <Item
        disabled={saving}
        closeOnSelect={false}
        status={saving ? "pending" : undefined}
        onSelect={pinMessage}
      >
        {t("agentPanel.stream.pinMessage")}
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
              <ThemedPin size={16} uniProps={iconColor} />
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
  onPin,
  sourceId,
  children,
}: {
  text: string;
  onPin?: MessagePinHandler;
  sourceId: string;
  children: ReactNode;
}) {
  const getContent = useCallback(() => text, [text]);
  return (
    <MessagePinControl getContent={getContent} onPin={onPin} sourceId={sourceId}>
      {children}
    </MessagePinControl>
  );
});
