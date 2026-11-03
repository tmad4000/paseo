import type { ComposerTextSource } from "@/composer/text-source";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

/** Longest quote Reply puts in the composer; the agent already has the full message. */
export const REPLY_QUOTE_MAX_CHARS = 600;

/**
 * Turns a message into a Markdown blockquote for Reply. Long messages are cut at
 * a line or word boundary near the limit and marked with an ellipsis.
 */
export function buildReplyQuote(text: string, maxChars = REPLY_QUOTE_MAX_CHARS): string {
  let body = text.replace(/\r\n?/g, "\n").trim();
  if (body.length === 0) return "";
  if (body.length > maxChars) {
    const cut = body.slice(0, maxChars);
    const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
    body = `${(boundary > maxChars / 2 ? cut.slice(0, boundary) : cut).trimEnd()} …`;
  }
  return body
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

/** Puts the quote above whatever is already typed, leaving the caret's line empty for the reply. */
export function insertReplyQuote(input: { currentText: string; quote: string }): string {
  if (input.quote.length === 0) return input.currentText;
  const rest = input.currentText.replace(/^\n+/, "");
  return rest.length > 0 ? `${input.quote}\n\n${rest}` : `${input.quote}\n\n`;
}

export type ReplyQuoteHandler = (text: string) => void;

interface ComposerQuoteContextValue {
  agentId: string;
  quote: ReplyQuoteHandler;
}

const ComposerQuoteContext = createContext<ComposerQuoteContextValue | null>(null);

/** Provided by the chat pane that owns the composer Reply writes into. */
export function ComposerQuoteProvider({
  agentId,
  textSource,
  setText,
  onQuoted,
  children,
}: {
  agentId: string;
  textSource: ComposerTextSource;
  setText: (text: string) => void;
  onQuoted: () => void;
  children: ReactNode;
}) {
  const quote = useCallback(
    (text: string) => {
      const quoted = buildReplyQuote(text);
      if (quoted.length === 0) return;
      setText(insertReplyQuote({ currentText: textSource.getSnapshot(), quote: quoted }));
      onQuoted();
    },
    [onQuoted, setText, textSource],
  );
  const value = useMemo(() => ({ agentId, quote }), [agentId, quote]);
  return <ComposerQuoteContext.Provider value={value}>{children}</ComposerQuoteContext.Provider>;
}

const MessageReplyContext = createContext<ReplyQuoteHandler | null>(null);

/**
 * Scopes Reply to one chat's messages. Reply is offered only when the composer
 * above belongs to this same chat, so a child or read-only timeline rendered
 * inside another chat's pane never quotes into the wrong composer.
 */
export function MessageReplyScope({
  agentId,
  readOnly,
  children,
}: {
  agentId: string;
  readOnly: boolean;
  children: ReactNode;
}) {
  const composer = useContext(ComposerQuoteContext);
  const handler = !readOnly && composer?.agentId === agentId ? composer.quote : null;
  return <MessageReplyContext.Provider value={handler}>{children}</MessageReplyContext.Provider>;
}

export function useMessageReply(): ReplyQuoteHandler | null {
  return useContext(MessageReplyContext);
}
