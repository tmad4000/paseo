import type { DesktopDaemonStatus } from "@/desktop/daemon/desktop-daemon";
import { i18n } from "@/i18n/i18next";
import type {
  DesktopReleaseChannel,
  DesktopRuntimeInfo,
  DesktopUpdateSource,
} from "./desktop-updates";

/** A release the feed actually published, with the tag GitHub serves it under. */
export interface PublishedRelease {
  version: string;
  tag: string;
}

/** Whether the line names a build being offered, or the one already installed. */
export type UpdateIdentityRole = "update" | "installed";

export interface UpdateIdentityInput {
  runtime: Pick<DesktopRuntimeInfo, "productName" | "updateSource">;
  role: UpdateIdentityRole;
  version: string;
  channel: DesktopReleaseChannel;
  published: PublishedRelease | null;
}

export interface UpdateIdentity {
  /** e.g. "Update: Paseo Fork v0.10.0-beta.33 · beta channel · from tmad4000/paseo" */
  line: string;
  /** Display form, with the leading v the rest of the update UI uses. */
  version: string;
  releaseNotesUrl: string | null;
}

function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v/i, "");
}

// Fork releases are tagged `0.10.0-beta.32`, upstream's `v0.16.0`, and fork
// tags skip versions. Only the release the feed returned has a known tag.
export function resolveReleaseTag(version: string, published: PublishedRelease): string | null {
  return stripVersionPrefix(version) === stripVersionPrefix(published.version)
    ? published.tag
    : null;
}

function buildReleaseNotesUrl(source: DesktopUpdateSource, tag: string | null): string {
  const releases = `https://github.com/${source.owner}/${source.repo}/releases`;
  return tag ? `${releases}/tag/${encodeURIComponent(tag)}` : releases;
}

/**
 * Names the product, version, channel and feed behind an update surface, so a
 * fork build never reads as upstream Paseo and an upstream build never claims
 * the fork's feed. Returns null until the desktop runtime has named the product.
 */
export function resolveUpdateIdentity(input: UpdateIdentityInput): UpdateIdentity | null {
  const { runtime, channel, published, role } = input;
  if (!runtime.productName) return null;
  const version = `v${stripVersionPrefix(input.version)}`;
  const values = {
    product: runtime.productName,
    version,
    channel: i18n.t(`desktop.updateIdentity.channel.${channel}`),
  };
  const source = runtime.updateSource;
  const build = source
    ? i18n.t("desktop.updateIdentity.lineWithSource", {
        ...values,
        source: `${source.owner}/${source.repo}`,
      })
    : i18n.t("desktop.updateIdentity.line", values);
  const line =
    role === "update" ? i18n.t("desktop.updateIdentity.update", { identity: build }) : build;
  const tag = published ? resolveReleaseTag(version, published) : null;
  const releaseNotesUrl = source ? buildReleaseNotesUrl(source, tag) : null;
  return { line, version, releaseNotesUrl };
}

export type UpdateRestartEffect =
  | "agentsStop"
  | "agentsStopKeepRunningOn"
  | "agentsKeepRunning"
  | "noDaemon"
  | "unknown";

export interface UpdateRestartEffectInput {
  daemon: Pick<DesktopDaemonStatus, "status" | "ownedByDesktop"> | null;
  keepRunningAfterQuit: boolean;
}

// Install and restart stops the daemon before quitting when this app launched it
// (`install_app_update` → stopDesktopDaemon("app_update")), whatever
// keepRunningAfterQuit says; that setting only governs an ordinary quit. Neither
// path stops a daemon started elsewhere (CLI, service, or a previous app session).
export function resolveUpdateRestartEffect(input: UpdateRestartEffectInput): UpdateRestartEffect {
  const { daemon } = input;
  if (daemon?.status === "stopped") return "noDaemon";
  const isRunning = daemon?.status === "running" || daemon?.status === "starting";
  // `errored` means the status probe failed; the daemon may still be alive.
  if (!daemon || !isRunning) return "unknown";
  if (!daemon.ownedByDesktop) return "agentsKeepRunning";
  return input.keepRunningAfterQuit ? "agentsStopKeepRunningOn" : "agentsStop";
}

export function formatUpdateRestartEffect(effect: UpdateRestartEffect): string {
  return i18n.t(`desktop.updateIdentity.restart.${effect}`);
}

export function formatUpdateWhatsNew(identity: UpdateIdentity): string {
  return i18n.t("desktop.updateIdentity.whatsNew", { version: identity.version });
}

export function resolvePublishedRelease(
  result: { publishedVersion?: string | null; publishedTag?: string | null } | null,
): PublishedRelease | null {
  const version = result?.publishedVersion;
  const tag = result?.publishedTag;
  return version && tag ? { version, tag } : null;
}
