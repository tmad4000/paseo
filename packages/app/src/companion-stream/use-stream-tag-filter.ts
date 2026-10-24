import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { toggleTag } from "./tag-model";

/** Shared tag-filter actions for per-chat and global Stream. */
export function useStreamTagFilter(
  query: { setTagPinned: (tag: string, pinned: boolean) => Promise<void> },
  setTags: Dispatch<SetStateAction<string[]>>,
) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const { setTagPinned } = query;
  const toggle = useCallback((tag: string) => setTags((tags) => toggleTag(tags, tag)), [setTags]);
  const add = useCallback(
    (tag: string) => setTags((tags) => (tags.includes(tag) ? tags : [...tags, tag])),
    [setTags],
  );
  const setPinned = useCallback(
    (tag: string, pinned: boolean) => {
      setError(null);
      setTagPinned(tag, pinned).catch(() => setError(t("agentPanel.stream.tags.pinFailed")));
    },
    [setTagPinned, t],
  );
  return { toggle, add, setPinned, error };
}
