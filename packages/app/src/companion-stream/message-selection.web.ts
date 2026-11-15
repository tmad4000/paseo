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
  const ownerId = messageIdForNode(root);
  const contained = root.contains(range.startContainer) && root.contains(range.endContainer);
  const sameMessage =
    ownerId &&
    messageIdForNode(range.startContainer) === ownerId &&
    messageIdForNode(range.endContainer) === ownerId;
  if (!contained && !sameMessage) return;
  return (
    (
      createAssistantSelectionClipboardContent(selection)?.plainText ?? selection.toString()
    ).trim() || undefined
  );
}

function messageIdForNode(node: Node): string | null | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest("[data-message-id]")?.getAttribute("data-message-id");
}
