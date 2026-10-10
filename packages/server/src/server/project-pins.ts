import type { PersistedProjectRecord, ProjectRegistry } from "./workspace-registry.js";

type ProjectPinRegistry = Pick<ProjectRegistry, "list" | "update">;

/**
 * Pins or unpins one project. Repeating a pin keeps the original timestamp, so the
 * most-recently-pinned ordering does not jump when two clients pin the same project.
 */
export async function setProjectPinned(input: {
  registry: ProjectPinRegistry;
  projectId: string;
  pinned: boolean;
  now: string;
}): Promise<PersistedProjectRecord | null> {
  return input.registry.update(input.projectId, (existing) => {
    const pinnedAt = input.pinned ? (existing.pinnedAt ?? input.now) : null;
    if ((existing.pinnedAt ?? null) === pinnedAt) return existing;
    return { ...existing, pinnedAt, updatedAt: input.now };
  });
}

/**
 * Makes a project this host's Default project, or removes it as default.
 *
 * Exactly one project per host is the default. The target is written first and the previous
 * default is cleared after it, so an interruption between the two writes leaves two defaults
 * rather than none; readers resolve that by taking the newest `defaultAt`.
 *
 * Returns every record this call changed, target first, so the caller can publish them.
 */
export async function setProjectDefault(input: {
  registry: ProjectPinRegistry;
  projectId: string;
  isDefault: boolean;
  now: string;
}): Promise<{ project: PersistedProjectRecord | null; changed: PersistedProjectRecord[] }> {
  const changed: PersistedProjectRecord[] = [];
  let targetChanged = false;
  const project = await input.registry.update(input.projectId, (existing) => {
    const defaultAt = input.isDefault ? (existing.defaultAt ?? input.now) : null;
    if ((existing.defaultAt ?? null) === defaultAt) return existing;
    targetChanged = true;
    return { ...existing, defaultAt, updatedAt: input.now };
  });
  if (!project) return { project: null, changed };
  if (targetChanged) changed.push(project);
  if (!input.isDefault) return { project, changed };

  const previousDefaults = (await input.registry.list()).filter(
    (record) => record.projectId !== input.projectId && record.defaultAt,
  );
  for (const previous of previousDefaults) {
    const cleared = await input.registry.update(previous.projectId, (existing) =>
      existing.defaultAt ? { ...existing, defaultAt: null, updatedAt: input.now } : existing,
    );
    if (cleared) changed.push(cleared);
  }
  return { project, changed };
}
