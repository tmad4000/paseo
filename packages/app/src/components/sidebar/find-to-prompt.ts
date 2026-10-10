import { openQuickLaunch, type QuickLaunchRequest } from "@/quick-launch/store";

/**
 * Find → prompt: turn what was typed in the sidebar filter into a new chat (docs/sidebar-filter.md).
 *
 * The ONE entry point for the filter's "Start a chat" row and its Mod+Enter / Mod+Shift+Enter
 * keys. It opens Quick launch with the query as the prompt, so the filter shares Quick launch's
 * single creation path (docs/quick-launch.md). No destination is passed: Quick launch resolves the
 * Default project itself. `startAndOpen` only preselects "Start and open"; the person still
 * confirms in the dialog. Returns whether the dialog was asked to open.
 */
export function startChatFromFilterQuery(
  input: { query: string; startAndOpen: boolean },
  open: (request: QuickLaunchRequest) => void = openQuickLaunch,
): boolean {
  const prompt = input.query.trim();
  if (!prompt) return false;
  open({ prompt, startAndOpen: input.startAndOpen });
  return true;
}
