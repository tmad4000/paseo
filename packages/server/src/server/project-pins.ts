import type {
  DefaultProjectMutation,
  PersistedProjectRecord,
  ProjectRegistry,
} from "./workspace-registry.js";

/**
 * Pins or unpins one project. Repeating a pin keeps the original timestamp, so the
 * most-recently-pinned ordering does not jump when two clients pin the same project.
 */
export async function setProjectPinned(input: {
  registry: Pick<ProjectRegistry, "update">;
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
 * Exactly one project per host is the default. The registry sets the target and clears every
 * previous default in one atomic write, so concurrent requests from two devices leave exactly
 * one default (the later request wins). Returns every record the call changed, target first,
 * so the caller can publish them.
 */
export async function setProjectDefault(input: {
  registry: Pick<ProjectRegistry, "setDefaultProject">;
  projectId: string;
  isDefault: boolean;
  now: string;
}): Promise<DefaultProjectMutation> {
  if (!input.registry.setDefaultProject) {
    throw new Error("This project registry cannot set a default project");
  }
  return input.registry.setDefaultProject({
    projectId: input.projectId,
    isDefault: input.isDefault,
    now: input.now,
  });
}
