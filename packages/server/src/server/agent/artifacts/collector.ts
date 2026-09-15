import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AgentArtifact,
  AgentArtifactKind,
  ToolCallTimelineItem,
} from "@getpaseo/protocol/agent-types";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".expo",
  ".next",
  ".paseo",
  ".turbo",
  "coverage",
  "node_modules",
]);
const MAX_SCANNED_ENTRIES = 20_000;
/** Backfill ceiling. A repo with committed build output can match thousands. */
const DEFAULT_BACKFILL_LIMIT = 200;

interface ArtifactFormat {
  kind: AgentArtifactKind;
  mimeType: string;
}

const ARTIFACT_FORMATS: Record<string, ArtifactFormat> = {
  ".diff": { kind: "diff", mimeType: "text/x-diff" },
  ".gif": { kind: "image", mimeType: "image/gif" },
  ".htm": { kind: "html", mimeType: "text/html" },
  ".html": { kind: "html", mimeType: "text/html" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".md": { kind: "markdown", mimeType: "text/markdown" },
  ".mdx": { kind: "markdown", mimeType: "text/markdown" },
  ".patch": { kind: "diff", mimeType: "text/x-diff" },
  ".pdf": { kind: "pdf", mimeType: "application/pdf" },
  ".png": { kind: "image", mimeType: "image/png" },
  ".svg": { kind: "svg", mimeType: "image/svg+xml" },
  ".webp": { kind: "image", mimeType: "image/webp" },
};

interface ActiveTurn {
  cwd: string;
  startedAt: number;
  candidates: Set<string>;
  watcher: FSWatcher | null;
}

export interface ArtifactCollectionResult {
  artifacts: AgentArtifact[];
  addedOrUpdated: number;
}

export class AgentArtifactCollector {
  private readonly activeTurns = new Map<string, ActiveTurn>();

  beginTurn(agentId: string, cwd: string): void {
    if (this.activeTurns.has(agentId)) {
      return;
    }
    const turn: ActiveTurn = {
      cwd: path.resolve(cwd),
      startedAt: Date.now(),
      candidates: new Set(),
      watcher: null,
    };
    try {
      turn.watcher = watch(turn.cwd, { recursive: true }, (_eventType, fileName) => {
        if (fileName) {
          this.addCandidate(turn, fileName.toString());
        }
      });
    } catch {
      turn.watcher = null;
    }
    this.activeTurns.set(agentId, turn);
  }

  observeToolCall(agentId: string, item: ToolCallTimelineItem): void {
    if (item.status !== "completed") {
      return;
    }
    if (item.detail.type !== "write" && item.detail.type !== "edit") {
      return;
    }
    const turn = this.activeTurns.get(agentId);
    if (turn) {
      this.addCandidate(turn, item.detail.filePath);
    }
  }

  async finishTurn(
    agentId: string,
    existingArtifacts: readonly AgentArtifact[],
  ): Promise<ArtifactCollectionResult | null> {
    const turn = this.activeTurns.get(agentId);
    if (!turn) {
      return null;
    }
    this.activeTurns.delete(agentId);
    turn.watcher?.close();

    const recentPaths = await findRecentlyModifiedArtifacts(turn.cwd, turn.startedAt);
    for (const recentPath of recentPaths) {
      turn.candidates.add(recentPath);
    }

    return mergeArtifactCandidates(turn.cwd, turn.candidates, existingArtifacts, null);
  }

  /**
   * Collects artifacts that already exist under `cwd`, whatever their age.
   *
   * Turn-scoped collection only ever sees files touched while a turn was
   * running, so an agent whose work predates this feature — or predates the
   * daemon build that carries it — shows an empty feed forever. This is the
   * backfill for that case, and it is deliberately explicit rather than
   * automatic: a full walk of a large working directory is not something to run
   * behind the user's back on every agent load.
   */
  async scanExisting(
    cwd: string,
    existingArtifacts: readonly AgentArtifact[],
    options?: { limit?: number },
  ): Promise<ArtifactCollectionResult | null> {
    // A zero cutoff makes the recency filter match everything.
    const candidates = await findRecentlyModifiedArtifacts(cwd, 0);
    const limit = options?.limit ?? DEFAULT_BACKFILL_LIMIT;
    return mergeArtifactCandidates(cwd, candidates, existingArtifacts, limit);
  }

  cancelTurn(agentId: string): void {
    const turn = this.activeTurns.get(agentId);
    turn?.watcher?.close();
    this.activeTurns.delete(agentId);
  }

  private addCandidate(turn: ActiveTurn, filePath: string): void {
    const relativePath = resolveRelativeArtifactPath(turn.cwd, filePath);
    if (relativePath && getArtifactFormat(relativePath)) {
      turn.candidates.add(relativePath);
    }
  }
}

/**
 * Merges freshly inspected candidates into an agent's existing artifact list.
 *
 * `limit` caps the retained list, keeping the most recently modified — a
 * backfill over a repo with a committed build directory can otherwise bury the
 * handful of files the user actually cares about. `null` keeps everything,
 * which is right for a single turn's output.
 */
async function mergeArtifactCandidates(
  cwd: string,
  candidates: Iterable<string>,
  existingArtifacts: readonly AgentArtifact[],
  limit: number | null,
): Promise<ArtifactCollectionResult | null> {
  const artifactsByPath = new Map(existingArtifacts.map((artifact) => [artifact.path, artifact]));
  let addedOrUpdated = 0;
  for (const candidate of candidates) {
    const artifact = await inspectArtifact(cwd, candidate, artifactsByPath.get(candidate));
    if (!artifact) {
      continue;
    }
    const previous = artifactsByPath.get(candidate);
    if (!previous || previous.updatedAt !== artifact.updatedAt || previous.size !== artifact.size) {
      artifactsByPath.set(candidate, artifact);
      addedOrUpdated += 1;
    }
  }
  if (addedOrUpdated === 0) {
    return null;
  }

  let artifacts = Array.from(artifactsByPath.values());
  artifacts.sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
  if (limit !== null && artifacts.length > limit) {
    artifacts = artifacts.slice(artifacts.length - limit);
  }
  return { artifacts, addedOrUpdated };
}

async function findRecentlyModifiedArtifacts(cwd: string, startedAt: number): Promise<string[]> {
  const matches: string[] = [];
  const pending = [cwd];
  let scannedEntries = 0;
  while (pending.length > 0 && scannedEntries < MAX_SCANNED_ENTRIES) {
    const directory = pending.pop();
    if (!directory) {
      break;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries > MAX_SCANNED_ENTRIES) {
        break;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(absolutePath);
        }
        continue;
      }
      if (!entry.isFile() || !getArtifactFormat(entry.name)) {
        continue;
      }
      try {
        const fileStat = await stat(absolutePath);
        if (fileStat.mtimeMs >= startedAt - 100) {
          matches.push(toPortableRelativePath(cwd, absolutePath));
        }
      } catch {
        continue;
      }
    }
  }
  return matches;
}

async function inspectArtifact(
  cwd: string,
  relativePath: string,
  previous: AgentArtifact | undefined,
): Promise<AgentArtifact | null> {
  const format = getArtifactFormat(relativePath);
  if (!format) {
    return null;
  }
  try {
    const fileStat = await stat(path.join(cwd, relativePath));
    if (!fileStat.isFile()) {
      return null;
    }
    const updatedAt = fileStat.mtime.toISOString();
    return {
      path: relativePath,
      name: path.basename(relativePath),
      kind: format.kind,
      mimeType: format.mimeType,
      size: fileStat.size,
      createdAt: previous?.createdAt ?? updatedAt,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function resolveRelativeArtifactPath(cwd: string, filePath: string): string | null {
  const absolutePath = path.resolve(cwd, filePath);
  const relativePath = path.relative(cwd, absolutePath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return null;
  }
  return relativePath.split(path.sep).join("/");
}

function toPortableRelativePath(cwd: string, absolutePath: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

function getArtifactFormat(filePath: string): ArtifactFormat | null {
  return ARTIFACT_FORMATS[path.extname(filePath).toLowerCase()] ?? null;
}
