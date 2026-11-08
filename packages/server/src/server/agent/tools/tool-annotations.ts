import type { PaseoToolAnnotations } from "./types.js";

/**
 * MCP tool annotations for Paseo's own tools.
 *
 * MCP clients use these hints to decide whether a call needs a human. Codex in
 * Default Permissions (`on-request` + `workspace-write`) prompts for every MCP
 * tool that lacks `readOnlyHint: true`, unless the tool is explicitly
 * non-destructive and closed-world. Without annotations, each `list_agents` or
 * `set_stream_ask` call by a Codex agent becomes an "MCP approval: paseo"
 * prompt that waits on the user.
 *
 * Only two groups are annotated:
 * - read-only inspection tools, and
 * - Stream bookkeeping writes, which change only revisioned Stream records and
 *   never run, message, stop or reconfigure an agent.
 *
 * Tools that look like reads but can start a provider session stay out:
 * `get_agent_activity` loads (resumes or creates) a stored agent before
 * reading its timeline, and `inspect_provider` may open a throwaway session to
 * list draft features.
 *
 * Everything else (creating, prompting, stopping or archiving agents, answering
 * permissions, changing modes, schedules, terminals, workspaces, browser tools
 * and voice) stays unannotated, so clients keep their normal approval gate.
 */
const READ_ONLY: PaseoToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

const STREAM_BOOKKEEPING: PaseoToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

export const PASEO_READ_ONLY_TOOL_NAMES = [
  "list_agents",
  "get_agent_status",
  "list_pending_permissions",
  "list_stream_asks",
  "list_profiles",
  "list_providers",
  "list_models",
  "list_schedules",
  "inspect_schedule",
  "schedule_logs",
  "list_terminals",
  "capture_terminal",
  "list_workspaces",
  "describe_workspace",
  "list_workspace_scripts",
  "list_queue",
] as const;

export const PASEO_STREAM_BOOKKEEPING_TOOL_NAMES = [
  "set_stream_ask",
  "set_stream_question",
  "set_stream_answer",
  "pin_stream_quote",
  "set_review_status",
] as const;

const PASEO_TOOL_ANNOTATIONS: ReadonlyMap<string, PaseoToolAnnotations> = new Map([
  ...PASEO_READ_ONLY_TOOL_NAMES.map((name) => [name, READ_ONLY] as const),
  ...PASEO_STREAM_BOOKKEEPING_TOOL_NAMES.map((name) => [name, STREAM_BOOKKEEPING] as const),
]);

export function resolvePaseoToolAnnotations(name: string): PaseoToolAnnotations | undefined {
  const annotations = PASEO_TOOL_ANNOTATIONS.get(name);
  return annotations ? { ...annotations } : undefined;
}
