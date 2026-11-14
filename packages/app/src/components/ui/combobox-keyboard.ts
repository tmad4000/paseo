export function getNextActiveIndex(args: {
  currentIndex: number;
  itemCount: number;
  key: "ArrowDown" | "ArrowUp";
}): number {
  const { currentIndex, itemCount, key } = args;

  if (itemCount <= 0) return -1;

  if (currentIndex < 0) {
    return key === "ArrowDown" ? 0 : itemCount - 1;
  }

  const normalizedCurrent = currentIndex % itemCount;
  return key === "ArrowDown"
    ? (normalizedCurrent + 1) % itemCount
    : (normalizedCurrent - 1 + itemCount) % itemCount;
}

/** Keep live result identity while metadata changes; queries start a new selection. */
export function resolveComboboxActiveIndex(input: {
  options: readonly { id: string }[];
  selectedId: string;
  search: string;
  position: "below-search" | "above-search";
  previous: { id: string | undefined; search: string };
  preserve: boolean | undefined;
}): number {
  const { options, selectedId, search, position, previous, preserve } = input;
  if (options.length === 0) return -1;
  if (preserve && previous.search === search) {
    const retained = options.findIndex((option) => option.id === previous.id);
    if (retained >= 0) return retained;
  }
  const fallback = position === "above-search" ? options.length - 1 : 0;
  if (search) return fallback;
  const selected = options.findIndex((option) => option.id === selectedId);
  return selected >= 0 ? selected : fallback;
}
