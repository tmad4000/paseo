import { getStreamItemMessageId } from "../presentation";
import { countTextMatches } from "./matches";
import type { ChatFindOperations } from "./model";
import type { ChatFindProps } from "./types";

interface ViewportInput {
  getBindings(): Pick<
    ChatFindProps,
    "viewportRef" | "revealLoadedMessage" | "visibleMessageIds" | "items"
  >;
}

const REVEAL_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;

/**
 * Native reveal. The web viewport reads the rendered DOM to find and highlight the
 * exact range; native has no DOM to read, so the message's row is mounted, the list
 * scrolls to it, and occurrences are counted in the message text. The selected row
 * is tinted by `ChatFindExpansion` so "jumped" is always visible even without a
 * range highlight.
 */
export function createNativeFindViewport({
  getBindings,
}: ViewportInput): Pick<ChatFindOperations, "reveal" | "clear"> {
  return {
    clear() {},
    reveal(messageId, query, occurrence, signal) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + REVEAL_TIMEOUT_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let scrolled = false;
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", cancelled);
        };
        const cancelled = () => {
          cleanup();
          reject(new Error("Search cancelled"));
        };
        const poll = () => {
          if (signal.aborted) {
            cancelled();
            return;
          }
          if (Date.now() >= deadline) {
            cleanup();
            reject(new Error("Could not reveal this match; retry"));
            return;
          }
          const current = getBindings();
          const rows = current.items.filter(
            (item) => item.id === messageId || getStreamItemMessageId(item) === messageId,
          );
          const mounted =
            current.visibleMessageIds.has(messageId) ||
            rows.some((item) => current.visibleMessageIds.has(getStreamItemMessageId(item)));
          if (!mounted) {
            current.revealLoadedMessage(messageId);
            timer = setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }
          if (!scrolled) {
            current.viewportRef.current?.scrollToMessage?.(messageId);
            scrolled = true;
          }
          const text = rows
            .map((item) => ("text" in item && typeof item.text === "string" ? item.text : ""))
            .join("\n");
          const count = countTextMatches(text, query);
          cleanup();
          if (!count) {
            resolve({ occurrence: 0, count: 0 });
            return;
          }
          const index = occurrence < 0 ? count - 1 : Math.min(occurrence, count - 1);
          resolve({ occurrence: index, count });
        };
        signal.addEventListener("abort", cancelled, { once: true });
        poll();
      });
    },
  };
}
