import type { StreamTagCount } from "@getpaseo/protocol/global-stream";

export interface TagCloudItem {
  tag: string;
  count: number;
  pinned: boolean;
  active: boolean;
  /** 0 (smallest) to 2 (largest); a mild step, not a heat map. */
  weight: 0 | 1 | 2;
}

/** Pinned tags first (in pin order), then by count, then name. Pinned and active tags always show. */
export function buildTagCloud(
  counts: readonly StreamTagCount[],
  pinned: readonly string[],
  active: readonly string[],
): TagCloudItem[] {
  const byTag = new Map(counts.map((item) => [item.tag, item.count]));
  const max = Math.max(0, ...counts.map((item) => item.count));
  const weight = (count: number): TagCloudItem["weight"] => {
    if (max < 3 || count <= 1) return 0;
    if (count / max >= 0.66) return 2;
    return count / max >= 0.33 ? 1 : 0;
  };
  const item = (tag: string): TagCloudItem => {
    const count = byTag.get(tag) ?? 0;
    return {
      tag,
      count,
      pinned: pinned.includes(tag),
      active: active.includes(tag),
      weight: weight(count),
    };
  };
  const rest = counts
    .filter((entry) => !pinned.includes(entry.tag))
    .map((entry) => entry.tag)
    .concat(active.filter((tag) => !byTag.has(tag) && !pinned.includes(tag)));
  return [...pinned.map(item), ...rest.map(item)];
}

export function toggleTag(tags: readonly string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag];
}

/** Sum counts from several hosts into one list sorted like the host's own. */
export function mergeTagCounts(lists: ReadonlyArray<readonly StreamTagCount[]>): StreamTagCount[] {
  const counts = new Map<string, number>();
  for (const list of lists)
    for (const { tag, count } of list) counts.set(tag, (counts.get(tag) ?? 0) + count);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Tags offered while typing: prefix matches first, then other matches, excluding chosen tags. */
export function suggestTags(
  known: readonly string[],
  draft: string,
  chosen: readonly string[],
  limit = 6,
): string[] {
  const query = draft.trim().replace(/^#+/, "").toLowerCase();
  const open = known.filter((tag) => !chosen.includes(tag));
  if (!query) return open.slice(0, limit);
  const prefix = open.filter((tag) => tag.startsWith(query));
  const inner = open.filter((tag) => !tag.startsWith(query) && tag.includes(query));
  return [...prefix, ...inner].slice(0, limit);
}
