import { z } from "zod";
import { readValidatedJson } from "@/storage/validated-storage";
import { APP_SETTINGS_KEY, SETTINGS_MIGRATIONS_KEY } from "./keys";
import type { AppSettings, KeyValueStorage, PersistedAppSettings } from "./storage";

const AppliedMigrationsSchema = z.strictObject({ applied: z.array(z.string()) });

/**
 * `sendBehavior` defaulted to "interrupt" for the months before steering existed, and defaults
 * are materialized into storage on first load, so a stored "interrupt" cannot be told apart from
 * a deliberate one. This flips every stored "interrupt" to "steer" exactly once; picking
 * "interrupt" afterwards sticks.
 */
const STEER_DEFAULT_MIGRATION = "steer-default";

/**
 * Existing installs materialized earlier tool-call defaults in storage, so the old default
 * cannot be distinguished from a deliberate choice. Switch to Summary once; later choices stick.
 */
const SUMMARY_TOOL_CALLS_MIGRATION = "summary-tool-calls";

/**
 * The sidebar slot defaulted to the diff stat, and that default was materialized into storage.
 * Last-active time is the new default; switch a stored "diff" once, and later choices stick.
 */
const LAST_ACTIVE_TRAILING_MIGRATION = "sidebar-trailing-last-active";

/** Existing mobile installs materialized the old 15px content default in storage. */
const MOBILE_CONTENT_16_MIGRATION = "mobile-content-16";

/**
 * Brings stored settings up to date, returning what the caller should use. Owns both writes so
 * the marker can only ever be written after the settings it describes: a failed marker write
 * leaves the migration to re-run harmlessly, while a failed settings write must leave the marker
 * unwritten or the migration is lost for good.
 */
export async function migrateAppSettings(
  settings: AppSettings,
  storage: KeyValueStorage,
  stored?: PersistedAppSettings,
  options: { native?: boolean } = {},
): Promise<AppSettings> {
  const migrationMarker = await readValidatedJson(
    storage,
    SETTINGS_MIGRATIONS_KEY,
    AppliedMigrationsSchema,
  );
  const applied = new Set(migrationMarker?.applied ?? []);
  let addedMigration = false;

  let migrated = settings;
  if (!applied.has(STEER_DEFAULT_MIGRATION)) {
    migrated =
      migrated.sendBehavior === "interrupt" ? { ...migrated, sendBehavior: "steer" } : migrated;
    applied.add(STEER_DEFAULT_MIGRATION);
    addedMigration = true;
  }

  if (!applied.has(SUMMARY_TOOL_CALLS_MIGRATION)) {
    migrated =
      migrated.toolCallDetailLevel !== "overview"
        ? { ...migrated, toolCallDetailLevel: "overview" }
        : migrated;
    applied.add(SUMMARY_TOOL_CALLS_MIGRATION);
    addedMigration = true;
  }

  if (!applied.has(LAST_ACTIVE_TRAILING_MIGRATION)) {
    migrated =
      migrated.sidebarWorkspaceTrailing === "diff"
        ? { ...migrated, sidebarWorkspaceTrailing: "timestamp" }
        : migrated;
    applied.add(LAST_ACTIVE_TRAILING_MIGRATION);
    addedMigration = true;
  }

  if (options.native && !applied.has(MOBILE_CONTENT_16_MIGRATION)) {
    migrated = migrated.contentFontSize === 15 ? { ...migrated, contentFontSize: 16 } : migrated;
    applied.add(MOBILE_CONTENT_16_MIGRATION);
    addedMigration = true;
  }

  if (!addedMigration) {
    return settings;
  }

  if (migrated !== settings) {
    const storedSidebarRowItems = stored?.sidebarRowItems ?? {};
    await storage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({
        ...stored,
        ...migrated,
        sidebarRowItems: { ...storedSidebarRowItems, ...migrated.sidebarRowItems },
      }),
    );
  }

  await storage.setItem(SETTINGS_MIGRATIONS_KEY, JSON.stringify({ applied: [...applied] }));
  return migrated;
}
