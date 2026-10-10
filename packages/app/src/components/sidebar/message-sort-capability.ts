import type { SidebarSortMode } from "./sidebar-filter-sort";

export type MessageSortAvailability = "ready" | "partial" | "loading" | "unsupported";

/**
 * One entry per visible host: true when it advertises conversationMessageActivity, false when
 * it is connected without it, undefined while its server info is unknown. A single older host
 * no longer disables the message sorts for every host; its chats fall back to legacy clocks.
 */
export function messageSortAvailability(
  hosts: readonly (boolean | undefined)[],
): MessageSortAvailability {
  if (hosts.some((support) => support === true)) {
    return hosts.some((support) => support === false) ? "partial" : "ready";
  }
  if (!hosts.length || hosts.some((support) => support === undefined)) return "loading";
  return "unsupported";
}

export function isMessageSortMode(mode: SidebarSortMode): boolean {
  return mode === "recent" || mode === "user" || mode === "assistant";
}

export function canUseMessageSort(availability: MessageSortAvailability): boolean {
  return availability === "ready" || availability === "partial";
}

/** The order actually applied. The saved preference is left untouched for when hosts allow it. */
export function effectiveSidebarSortMode(
  mode: SidebarSortMode,
  availability: MessageSortAvailability,
): SidebarSortMode {
  if (isMessageSortMode(mode) && !canUseMessageSort(availability)) return "manual";
  return mode;
}
