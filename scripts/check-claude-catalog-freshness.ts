import { readFile } from "node:fs/promises";
import { getClaudeModels } from "../packages/server/src/server/agent/providers/claude/models.js";
import { parseClaudeCodeVersion } from "../packages/server/src/server/agent/providers/claude/model-manifest.js";

// Compare an explicitly captured daemon listing with this checkout. This is a read-only
// diagnostic, never a source of new model IDs or authorization to deploy this checkout.
async function main(): Promise<void> {
  const [versionInput, listingPath] = process.argv.slice(2);
  const version = versionInput ? parseClaudeCodeVersion(versionInput) : null;
  if (!version || !listingPath) {
    throw new Error(
      "Usage: npx tsx scripts/check-claude-catalog-freshness.ts <daemon-Claude-version> <paseo-models.json>",
    );
  }
  const listing: unknown = JSON.parse(await readFile(listingPath, "utf8"));
  if (
    !Array.isArray(listing) ||
    !listing.every(
      (row: unknown) =>
        typeof row === "object" && row !== null && "id" in row && typeof row.id === "string",
    )
  ) {
    throw new Error("Expected paseo provider models claude --json output (array with string IDs)");
  }
  const installed = new Set<string>(listing.map((row: { id: string }) => row.id));
  const expected = new Set(
    getClaudeModels(version.join("."))
      .filter((model) => model.isSelectable !== false)
      .map((model) => model.id),
  );
  const missingFromDaemon = [...expected].filter((id) => !installed.has(id));
  const outsideManifest = [...installed].filter((id) => !expected.has(id));
  console.log(JSON.stringify({ version, missingFromDaemon, outsideManifest }, null, 2));
  // Outside-manifest entries can be explicitly configured custom models. Do not remove them.
  process.exitCode = missingFromDaemon.length ? 1 : 0;
}

void main();
