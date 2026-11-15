/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBrowserMarkdownDocument } from "./use-markdown-document";

const markdownPage = { contentType: "text/plain", text: "# Plan" };

describe("useBrowserMarkdownDocument", () => {
  it("probes once loading stops and returns the Markdown source", async () => {
    const probe = vi.fn(async () => markdownPage);
    const { result, rerender } = renderHook((props) => useBrowserMarkdownDocument(props), {
      initialProps: { url: "http://h/plan.md", isLoading: true, probe },
    });

    expect(probe).not.toHaveBeenCalled();
    expect(result.current).toBeNull();

    rerender({ url: "http://h/plan.md", isLoading: false, probe });
    await waitFor(() => expect(result.current).toBe("# Plan"));
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("drops the previous document as soon as the URL changes", async () => {
    let resolveSecond: (value: unknown) => void = () => {};
    const probe = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(markdownPage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const { result, rerender } = renderHook((props) => useBrowserMarkdownDocument(props), {
      initialProps: { url: "http://h/plan.md", isLoading: false, probe },
    });
    await waitFor(() => expect(result.current).toBe("# Plan"));

    rerender({ url: "http://h/site.html", isLoading: false, probe });
    expect(result.current).toBeNull();

    resolveSecond({ contentType: "text/html", text: "" });
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    expect(result.current).toBeNull();
  });

  it("ignores a late answer for a page the tab already left", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const probe = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ contentType: "text/html", text: "" });
    const { result, rerender } = renderHook((props) => useBrowserMarkdownDocument(props), {
      initialProps: { url: "http://h/plan.md", isLoading: false, probe },
    });
    rerender({ url: "http://h/other.md", isLoading: false, probe });
    resolveFirst(markdownPage);

    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    expect(result.current).toBeNull();
  });

  it("probes the same page again when the revision changes", async () => {
    // First probe runs before the guest is attached, as on a pane remount.
    const probe = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(markdownPage);
    const { result, rerender } = renderHook((props) => useBrowserMarkdownDocument(props), {
      initialProps: { url: "http://h/plan.md", isLoading: false, probe, revision: 0 },
    });
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();

    rerender({ url: "http://h/plan.md", isLoading: false, probe, revision: 1 });
    await waitFor(() => expect(result.current).toBe("# Plan"));
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("keeps the page raw when the probe fails", async () => {
    const probe = vi.fn(async () => {
      throw new Error("guest gone");
    });
    const { result } = renderHook(() =>
      useBrowserMarkdownDocument({ url: "http://h/plan.md", isLoading: false, probe }),
    );
    await waitFor(() => expect(probe).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
