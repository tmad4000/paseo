import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { ensureUnarchivedAgentLoaded, type EnsureAgentLoadedDeps } from "./agent-loading.js";
import type { AgentManager } from "./agent-manager.js";

const CheckpointSchema = z.object({ version: z.literal(1), agentIds: z.array(z.string().min(1)) });
const checkpointPath = (home: string) => path.join(home, "restart-sessions.json");

export function restartCheckpointWriter(home: string, enabled: boolean) {
  return enabled ? (ids: string[]) => saveRestartCheckpoint(home, ids) : undefined;
}

export async function saveRestartCheckpoint(home: string, agentIds: string[]): Promise<void> {
  await writeJsonFileAtomic(checkpointPath(home), { version: 1, agentIds });
}

export async function clearRestartCheckpoint(home: string): Promise<void> {
  await rm(checkpointPath(home), { force: true });
}

/** Reload provider handles, never replay a prompt or resurrect an archived session. */
export async function restoreRestartCheckpoint(
  home: string,
  deps: EnsureAgentLoadedDeps & { agentManager: AgentManager },
): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(checkpointPath(home), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const checkpoint = CheckpointSchema.parse(JSON.parse(raw));
  const restored: string[] = [];
  const failed: string[] = [];
  // Bound simultaneous provider starts; a large resident fleet should not burst all
  // its SDK processes into the replacement worker at once.
  const pending = [...new Set(checkpoint.agentIds)];
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length > 0) {
        const agentId = pending.shift()!;
        const record = await deps.agentStorage.get(agentId);
        if (!record || record.archivedAt || record.internal || !record.persistence) continue;
        try {
          await ensureUnarchivedAgentLoaded(agentId, deps);
          restored.push(agentId);
        } catch (error) {
          failed.push(agentId);
          if (deps.agentManager.getAgent(agentId) && !deps.agentManager.hasInFlightRun(agentId)) {
            await deps.agentManager
              .closeAgent(agentId)
              .catch((closeError) =>
                deps.logger.warn(
                  { err: closeError, agentId },
                  "Failed to close incomplete restart restoration",
                ),
              );
          }
          const latest = await deps.agentStorage.get(agentId);
          if (latest && !latest.archivedAt) {
            await deps.agentStorage.upsert({
              ...latest,
              lastStatus: "error",
              lastError: `Could not restore after daemon restart: ${error instanceof Error ? error.message : String(error)}`,
              requiresAttention: true,
              attentionReason: "error",
              attentionTimestamp: new Date().toISOString(),
            });
          }
          deps.logger.error(
            { err: error, agentId },
            "Failed to restore agent after graceful restart",
          );
        }
      }
    }),
  );
  if (failed.length) await saveRestartCheckpoint(home, failed);
  else await clearRestartCheckpoint(home);
  return restored;
}
