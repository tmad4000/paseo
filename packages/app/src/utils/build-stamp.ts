import Constants from "expo-constants";

export function formatBuildStamp(stamp: unknown, now = Date.now()): string | null {
  if (!stamp || typeof stamp !== "object") return null;
  const { buildTime, commit } = stamp as { buildTime?: unknown; commit?: unknown };
  if (typeof buildTime !== "string" || typeof commit !== "string") return null;
  const date = new Date(buildTime);
  const age = (now - date.getTime()) / 1000;
  if (!Number.isFinite(age)) return null;
  const exact = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" }).format(
    date,
  );
  let relative: string;
  if (age < -120 || age >= 604800)
    relative = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" as const } : {}),
    }).format(date);
  else if (age < 60) relative = "just now";
  else if (age < 3600) relative = `${Math.floor(age / 60)}m ago`;
  else if (age < 86400) relative = `${Math.floor(age / 3600)}h ago`;
  else relative = `${Math.floor(age / 86400)}d ago`;
  return `Updated ${relative}\n${exact} (build time)\nCommit ${commit}`;
}
export function resolveBuildStamp(): unknown {
  return Constants.expoConfig?.extra?.buildStamp;
}
