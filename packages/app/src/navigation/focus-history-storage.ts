import { z } from "zod";
import { WorkspaceTabTargetStorageSchema } from "@/stores/workspace-layout-storage";
import type { NavigationFocusLocation } from "./focus-history";

export const FOCUS_HISTORY_STORAGE_KEY = "paseo:focus-history";

export interface FocusHistoryStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

const LocationSchema: z.ZodType<NavigationFocusLocation> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("route"), pathname: z.string().startsWith("/") }),
  z.strictObject({
    kind: z.literal("workspace"),
    serverId: z.string().min(1),
    workspaceId: z.string().min(1),
    paneId: z.string().nullable(),
    tabId: z.string().nullable(),
    target: WorkspaceTabTargetStorageSchema.nullable(),
    view: z.strictObject({
      panel: z.enum(["agent", "agent-list", "file-explorer"]),
      explorerTab: z.enum(["changes", "files", "pr"]),
    }),
  }),
]);

const HistorySchema = z.strictObject({
  version: z.literal(1),
  current: LocationSchema.nullable(),
  past: z.array(LocationSchema),
  future: z.array(LocationSchema),
});

export function parseStoredFocusHistory(stored: string | null) {
  if (stored === null) return null;
  try {
    const parsed = HistorySchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
