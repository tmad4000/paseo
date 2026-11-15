import { readFileSync } from "node:fs";

export interface UpdateSource {
  owner: string;
  repo: string;
}

function readTopLevelValue(yaml: string, key: string): string | null {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(yaml);
  const value = match?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
  return value ? value : null;
}

// electron-builder serializes the publish target into a flat app-update.yml; that
// file is the feed electron-updater actually reads, so it names the update source.
export function parseUpdateSource(appUpdateYml: string): UpdateSource | null {
  if (readTopLevelValue(appUpdateYml, "provider") !== "github") return null;
  const owner = readTopLevelValue(appUpdateYml, "owner");
  const repo = readTopLevelValue(appUpdateYml, "repo");
  return owner && repo ? { owner, repo } : null;
}

export function readUpdateSource(appUpdateYmlPath: string): UpdateSource | null {
  try {
    return parseUpdateSource(readFileSync(appUpdateYmlPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
