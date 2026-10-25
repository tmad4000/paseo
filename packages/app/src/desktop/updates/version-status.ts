export type VersionStatus = "current" | "update" | "ahead" | "unknown" | "checking" | "offline";

export type ReleaseVersionCheck =
  | { state: "unknown" | "checking" }
  | { state: "checked"; latestVersion: string | null };

// Compare release versions without treating beta.10 as older than beta.9, or
// treating a locally built version newer than the feed as needing a downgrade.
function parseVersion(value: string | null) {
  const match = value
    ?.trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([\da-zA-Z.-]+))?(?:\+[\da-zA-Z.-]+)?$/);
  if (!match) return null;
  return { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split(".") ?? [] };
}

export function resolveVersionStatus(
  version: string | null,
  check: ReleaseVersionCheck,
  connected = true,
): VersionStatus {
  if (!connected) return "offline";
  if (check.state === "checking") return "checking";
  if (check.state !== "checked") return "unknown";
  const current = parseVersion(version);
  const latest = parseVersion(check.latestVersion);
  if (!current || !latest) return "unknown";
  return compareReleaseVersions(current, latest);
}

function compareReleaseVersions(
  current: NonNullable<ReturnType<typeof parseVersion>>,
  latest: NonNullable<ReturnType<typeof parseVersion>>,
): VersionStatus {
  for (let i = 0; i < 3; i++) {
    if (current.core[i] !== latest.core[i]) {
      return current.core[i]! < latest.core[i]! ? "update" : "ahead";
    }
  }
  if (!current.prerelease.length && latest.prerelease.length) return "ahead";
  if (current.prerelease.length && !latest.prerelease.length) return "update";
  const count = Math.max(current.prerelease.length, latest.prerelease.length);
  for (let i = 0; i < count; i++) {
    const a = current.prerelease[i];
    const b = latest.prerelease[i];
    if (a === b) continue;
    if (a === undefined) return "update";
    if (b === undefined) return "ahead";
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      if (Number(a) === Number(b)) continue;
      return Number(a) < Number(b) ? "update" : "ahead";
    }
    if (aNumeric !== bNumeric) return aNumeric ? "update" : "ahead";
    return a < b ? "update" : "ahead";
  }
  return "current";
}
