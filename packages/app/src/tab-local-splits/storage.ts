import { z } from "zod";
import type { TabLocalLayout, TabLocalNode } from "@/tab-local-splits/model";

/**
 * Persisted on its own key, beside `workspace-layout-state` v2 and never inside it: that schema
 * is strict, so a new field there would wipe the whole layout on any older build. An older build
 * ignores this key and shows the members as ordinary tabs.
 */
export const TAB_LOCAL_SPLITS_STORAGE_KEY = "tab-local-splits";
export const TAB_LOCAL_SPLITS_PERSIST_VERSION = 1;

const TabLocalNodeStorageSchema: z.ZodType<TabLocalNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("leaf"), tabId: z.string() }),
    z.strictObject({ kind: z.literal("chooser"), id: z.string() }),
    z.strictObject({
      kind: z.literal("group"),
      id: z.string(),
      direction: z.enum(["horizontal", "vertical"]),
      children: z.array(TabLocalNodeStorageSchema),
      sizes: z.array(z.number()),
    }),
  ]),
);

const TabLocalLayoutStorageSchema: z.ZodType<TabLocalLayout> = z.strictObject({
  hostTabId: z.string(),
  root: TabLocalNodeStorageSchema,
  focusedLeafId: z.string(),
});

export const TabLocalSplitsPersistedStateSchema = z.strictObject({
  /** `${serverId}:${workspaceId}` -> host tab id -> composite. */
  layoutsByWorkspace: z.record(z.string(), z.record(z.string(), TabLocalLayoutStorageSchema)),
});

export type TabLocalSplitsPersistedState = z.infer<typeof TabLocalSplitsPersistedStateSchema>;
