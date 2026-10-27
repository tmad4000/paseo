import { i18n } from "@/i18n/i18next";

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Raw transport failures from the daemon client and the platform network stack.
// They mean "the host could not be reached just now", not that the action was wrong.
const CONNECTION_ERROR_PATTERNS: readonly RegExp[] = [
  /\bTransport not connected\b(?: \(status: \w+\))?/i,
  /\bTransport disconnected before connect\b/i,
  /\b\w+ timed out \(\d+ ?ms\)/i,
  /\bTimed out waiting for agent\b\S*(?: \S+)?/i,
  /\bHistory sync timed out\b(?: after \d+s)?/i,
  /\bWebSocket (?:is )?not (?:open|available)\b(?: \(readyState=\d+\))?/i,
  /\bEncrypted channel not ready\b/i,
  /\bDaemon client (?:is )?(?:closed|disposed|disconnected)\b/i,
  /\bHost \S+ is not connected\b/i,
  /\b(?:Failed to fetch|Network request failed|NetworkError|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up)\b/i,
];

function findConnectionError(message: string): RegExpExecArray | null {
  for (const pattern of CONNECTION_ERROR_PATTERNS) {
    const match = pattern.exec(message);
    if (match) return match;
  }
  return null;
}

export function isConnectionErrorMessage(message: string): boolean {
  return findConnectionError(message) !== null;
}

/**
 * Replaces raw connection failures with a plain explanation, keeping a leading
 * "What failed:" context when a caller added one. Every other message passes
 * through unchanged; callers keep the raw text for diagnostics.
 */
export function toDisplayErrorMessage(message: string): string {
  const text = message.trim();
  const match = findConnectionError(text);
  if (!match) return message;
  const friendly = i18n.t("common.errors.connectionInterrupted");
  const prefix = text.slice(0, match.index).trimEnd();
  return prefix.endsWith(":") ? `${prefix} ${friendly}` : friendly;
}
