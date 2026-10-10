/**
 * The draft text after another surface hands Quick launch a prompt. An unsent draft the user
 * left behind is kept below the new prompt rather than overwritten.
 */
export function mergeQuickLaunchPrompt(input: { requested: string; existing: string }): string {
  const existing = input.existing.trim();
  if (!existing || existing === input.requested.trim()) return input.requested;
  return `${input.requested}\n\n${input.existing}`;
}
