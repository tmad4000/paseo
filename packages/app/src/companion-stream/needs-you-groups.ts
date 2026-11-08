import AsyncStorage from "@react-native-async-storage/async-storage";
import { needsYouGroup, type NeedsYouGroup } from "@getpaseo/protocol/companion-stream";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { GlobalStreamRow } from "./use-global-stream";

/** Blocked work leads (it usually waits on the user), then questions, then permissions. */
export const NEEDS_YOU_GROUP_ORDER: readonly NeedsYouGroup[] = [
  "blocked",
  "question",
  "permission",
];

export type NeedsYouListItem =
  | { type: "header"; group: NeedsYouGroup; count: number; collapsed: boolean }
  | { type: "row"; row: GlobalStreamRow };

export function rowNeedsYouGroup(row: GlobalStreamRow): NeedsYouGroup {
  return row.item.kind === "entry" ? needsYouGroup(row.item.entry) : "question";
}

/**
 * Needs you's Now side as groups with a header each; rows keep their order (newest first)
 * within a group. A collapsed group keeps its header and count. Empty groups are left out.
 */
export function groupNeedsYouRows(
  rows: readonly GlobalStreamRow[],
  collapsed: readonly NeedsYouGroup[],
): NeedsYouListItem[] {
  const byGroup = new Map<NeedsYouGroup, GlobalStreamRow[]>();
  for (const row of rows) {
    const group = rowNeedsYouGroup(row);
    byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
  }
  const items: NeedsYouListItem[] = [];
  for (const group of NEEDS_YOU_GROUP_ORDER) {
    const groupRows = byGroup.get(group);
    if (!groupRows?.length) continue;
    const isCollapsed = collapsed.includes(group);
    items.push({ type: "header", group, count: groupRows.length, collapsed: isCollapsed });
    if (!isCollapsed) for (const row of groupRows) items.push({ type: "row", row });
  }
  return items;
}

const PersistedGroupsSchema = z.object({
  collapsed: z.array(z.enum(["blocked", "question", "permission"])),
});

interface NeedsYouGroupsState {
  collapsed: NeedsYouGroup[];
  toggle: (group: NeedsYouGroup) => void;
}

/** Which Needs you groups are collapsed; remembered on this device. Default: all expanded. */
export const useNeedsYouGroupsStore = create<NeedsYouGroupsState>()(
  persist<NeedsYouGroupsState, [], [], { collapsed: NeedsYouGroup[] }>(
    (set) => ({
      collapsed: [],
      toggle: (group) =>
        set((state) => ({
          collapsed: state.collapsed.includes(group)
            ? state.collapsed.filter((item) => item !== group)
            : [...state.collapsed, group],
        })),
    }),
    {
      name: "needs-you-groups",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedGroupsSchema),
      partialize: (state) => ({ collapsed: state.collapsed }),
    },
  ),
);
