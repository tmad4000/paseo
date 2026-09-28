/**
 * Plain-text occurrence counting for platforms without DOM ranges. Matching mirrors
 * `ranges.web.ts`: case-insensitive, and any run of whitespace in the query matches
 * any run of whitespace in the text, so a query typed with one space still finds a
 * line-wrapped phrase.
 */
export function buildFindPattern(query: string): RegExp | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const pattern = trimmed
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(pattern, "giu");
}

export function countTextMatches(text: string, query: string): number {
  const pattern = buildFindPattern(query);
  if (!pattern) return 0;
  let count = 0;
  for (const _ of text.matchAll(pattern)) count += 1;
  return count;
}
