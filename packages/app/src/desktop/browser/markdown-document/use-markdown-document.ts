import { useEffect, useState } from "react";
import { readMarkdownDocumentProbe } from "./model";

interface ProbedDocument {
  url: string;
  source: string | null;
}

/**
 * Reads the loaded page back from the guest once loading stops and returns its
 * Markdown source when the page is a raw Markdown document. The result is keyed
 * by URL, so a navigation drops it before the next probe answers.
 */
export function useBrowserMarkdownDocument(input: {
  url: string | null;
  isLoading: boolean;
  probe: () => Promise<unknown>;
  /** Bump to probe the same page again, for example once the guest is attached. */
  revision?: number;
}): string | null {
  const { url, isLoading, probe, revision } = input;
  const [probed, setProbed] = useState<ProbedDocument | null>(null);

  useEffect(() => {
    if (!url || isLoading) return;
    let cancelled = false;
    const settle = (source: string | null) => {
      if (!cancelled) setProbed({ url, source });
    };
    probe().then(
      (result) => settle(readMarkdownDocumentProbe(result, url)),
      () => settle(null),
    );
    return () => {
      cancelled = true;
    };
  }, [url, isLoading, probe, revision]);

  return probed && probed.url === url ? probed.source : null;
}
