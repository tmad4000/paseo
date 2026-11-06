import type { WorkspaceDescribedAsk, WorkspaceDescribedPin } from "./messages.js";

/**
 * Derived focus summary for one agent in describe_workspace.
 *
 * Deterministic on purpose: no model call, so another agent can ask "what is the other tab on"
 * cheaply and get the same answer twice. The inputs are the first and last things the user said,
 * the head of the last assistant reply, and the conversation's open asks and pins.
 */

export const WORKSPACE_FOCUS_LIMITS = {
  firstUserChars: 280,
  lastUserChars: 280,
  lastAssistantChars: 320,
  askChars: 140,
  pinChars: 120,
  asksInSummary: 5,
  pinsInSummary: 3,
} as const;

export interface WorkspaceFocusInput {
  title: string | null;
  firstUserMessage: string | null;
  lastUserMessage: string | null;
  lastAssistantMessage: string | null;
  openAsks: readonly WorkspaceDescribedAsk[] | null;
  pins: readonly WorkspaceDescribedPin[] | null;
}

/** Collapse whitespace and cut to `max` characters at a word boundary where one is close. */
export function truncateFocusText(text: string | null | undefined, max: number): string | null {
  if (typeof text !== "string") return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const head = space >= max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:.-]+$/, "")}…`;
}

function quote(text: string): string {
  return `"${text}"`;
}

export function buildWorkspaceFocusSummary(input: WorkspaceFocusInput): string {
  const limits = WORKSPACE_FOCUS_LIMITS;
  const first = truncateFocusText(input.firstUserMessage, limits.firstUserChars);
  const last = truncateFocusText(input.lastUserMessage, limits.lastUserChars);
  const reply = truncateFocusText(input.lastAssistantMessage, limits.lastAssistantChars);
  const sentences: string[] = [];

  if (first) sentences.push(`Started with ${quote(first)}.`);
  if (last && last !== first) sentences.push(`Latest user message: ${quote(last)}.`);
  if (reply) sentences.push(`Last reply began: ${quote(reply)}.`);

  const asks = input.openAsks ?? [];
  if (asks.length > 0) {
    const shown = asks
      .slice(0, limits.asksInSummary)
      .map((ask) => `${truncateFocusText(ask.text, limits.askChars) ?? ask.askId} [${ask.state}]`);
    const more = asks.length > shown.length ? ` (+${asks.length - shown.length} more)` : "";
    sentences.push(`Open asks: ${shown.join("; ")}${more}.`);
  }

  const pins = input.pins ?? [];
  if (pins.length > 0) {
    const shown = pins
      .slice(0, limits.pinsInSummary)
      .flatMap((pin) => truncateFocusText(pin.text, limits.pinChars) ?? []);
    if (shown.length > 0) {
      const more = pins.length > shown.length ? ` (+${pins.length - shown.length} more)` : "";
      sentences.push(`Pinned: ${shown.map(quote).join("; ")}${more}.`);
    }
  }

  if (sentences.length === 0) {
    const title = truncateFocusText(input.title, limits.firstUserChars);
    return title
      ? `No readable conversation yet; titled ${quote(title)}.`
      : "No readable conversation yet.";
  }
  return sentences.join(" ");
}
