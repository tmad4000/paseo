/**
 * Pasting a session's id (or the short prefix Paseo shows, like `9b8394eb`) into any search
 * should find that session. Agent ids are lowercase UUIDs, so an id-shaped query is hex with
 * optional dashes. It must contain a digit, so ordinary words spelled with a-f ("facade",
 * "decade") still search as words.
 */
const SESSION_ID_QUERY = /^[0-9a-f]{6,}(?:-[0-9a-f]*)*$/;
const MAX_SESSION_ID_LENGTH = 36;

/** The normalized id prefix when `query` looks like a session id, otherwise null. */
export function parseSessionIdQuery(query: string): string | null {
  const normalized = query.trim().toLowerCase();
  if (normalized.length > MAX_SESSION_ID_LENGTH) return null;
  if (!SESSION_ID_QUERY.test(normalized) || !/[0-9]/.test(normalized)) return null;
  return normalized;
}

/** True when `sessionId` starts with the id-shaped `query`. */
export function matchesSessionIdQuery(sessionId: string, query: string): boolean {
  const prefix = parseSessionIdQuery(query);
  return prefix !== null && sessionId.toLowerCase().startsWith(prefix);
}

/** The short form Paseo shows beside a session: the first block of its id. */
export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}
