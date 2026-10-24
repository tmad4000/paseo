export const USER_PROMPT_PREVIEW_CHARACTERS = 400;
export const USER_PROMPT_PREVIEW_LINES = 6;

const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function getUserMessagePreview(message: string): { text: string; truncated: boolean } {
  let end = Math.min(message.length, USER_PROMPT_PREVIEW_CHARACTERS);
  let lines = 1;
  for (let i = 0; i < end; i++) {
    if (message[i] === "\n" && ++lines > USER_PROMPT_PREVIEW_LINES) {
      end = i;
      break;
    }
  }
  if (end === message.length) return { text: message, truncated: false };
  if (segmenter) end = segmenter.segment(message).containing(end)!.index;
  else if (/[\uD800-\uDBFF]/.test(message.charAt(end - 1))) end--;
  return { text: `${message.slice(0, end).trimEnd()}…`, truncated: true };
}
