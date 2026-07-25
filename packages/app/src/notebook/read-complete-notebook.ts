import type { AgentNotebookPage, DaemonClient } from "@getpaseo/client/internal/daemon-client";

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 100;

export type CompleteNotebookReadErrorCode =
  | "empty_response"
  | "inconsistent_revision"
  | "invalid_sequence"
  | "no_progress"
  | "page_limit";

export class CompleteNotebookReadError extends Error {
  constructor(readonly code: CompleteNotebookReadErrorCode) {
    super(code);
    this.name = "CompleteNotebookReadError";
  }
}

export async function readCompleteNotebook(
  client: Pick<DaemonClient, "getAgentNotebook">,
  agentId: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<AgentNotebookPage> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const events: AgentNotebookPage["events"] = [];
  let firstPage: AgentNotebookPage | null = null;
  let afterSequence: number | undefined;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await client.getAgentNotebook({
      agentId,
      afterSequence,
      limit: pageSize,
    });
    if (
      firstPage &&
      (firstPage.notebook.revision !== page.notebook.revision ||
        firstPage.writable !== page.writable ||
        firstPage.readOnlyReason !== page.readOnlyReason)
    ) {
      throw new CompleteNotebookReadError("inconsistent_revision");
    }
    firstPage ??= page;

    for (const event of page.events) {
      const expectedSequence = (events.at(-1)?.sequence ?? 0) + 1;
      if (event.sequence !== expectedSequence) {
        throw new CompleteNotebookReadError("invalid_sequence");
      }
      events.push(event);
    }

    if (!page.hasMore) {
      if (events.length !== page.notebook.lastSequence) {
        throw new CompleteNotebookReadError("invalid_sequence");
      }
      return {
        ...firstPage,
        notebook: page.notebook,
        events,
        hasMore: false,
      };
    }

    const lastEvent = page.events.at(-1);
    if (!lastEvent || lastEvent.sequence === afterSequence) {
      throw new CompleteNotebookReadError("no_progress");
    }
    afterSequence = lastEvent.sequence;
  }

  if (!firstPage) {
    throw new CompleteNotebookReadError("empty_response");
  }
  throw new CompleteNotebookReadError("page_limit");
}
