/**
 * Errors that prove a prompt never reached the provider. A caller holding a
 * durable delivery receipt may clear it and retry with the same message id,
 * because no provider can have accepted the earlier attempt.
 *
 * Anything else that fails after dispatch began (a lost connection, a run-start
 * timeout, a crash) is ambiguous and must stay guarded.
 */
const NOT_SUBMITTED_CODES = new Set([
  // The run reservation was lost to a competing run, or a pending permission blocked it.
  "AGENT_RUN_BUSY",
  // Loading, unarchiving or reserving the run failed before provider dispatch.
  "AGENT_PROMPT_NOT_SUBMITTED",
  // Strict steering: the active turn refused the steer and was left running.
  "AGENT_STEER_REJECTED",
]);

export const STEER_REJECTED_MESSAGE =
  "The active turn cannot accept a steer. It was not interrupted.";

export function steerRejectedError(message: string = STEER_REJECTED_MESSAGE): Error {
  return Object.assign(new Error(message), { code: "AGENT_STEER_REJECTED" });
}

export function isPromptNotSubmittedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    NOT_SUBMITTED_CODES.has(error.code)
  );
}
