import { createAssistantSelectionClipboardContent } from "@/assistant-selection-copy/content.web";

export function getMessageSelection(root: unknown): string | undefined {
  const selection = window.getSelection();
  if (
    !(root instanceof Element) ||
    !selection ||
    selection.isCollapsed ||
    selection.rangeCount !== 1
  )
    return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  return (
    (
      createAssistantSelectionClipboardContent(selection)?.plainText ?? selection.toString()
    ).trim() || undefined
  );
}
