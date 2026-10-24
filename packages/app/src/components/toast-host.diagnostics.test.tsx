/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setClientDiagnosticSink } from "@/diagnostics/client-errors/record";
import { useToastHost } from "./toast-host";

let uninstallSink: (() => void) | null = null;
afterEach(() => uninstallSink?.());

describe("toast diagnostics", () => {
  it("records every error and warning toast the person sees, and nothing else", () => {
    const recorded: Array<{ source: string; severity?: string; message: unknown }> = [];
    uninstallSink = setClientDiagnosticSink((input) => recorded.push(input));
    const { result } = renderHook(() => useToastHost());
    act(() => result.current.api.error("Voice failed to start: Host is not connected"));
    act(() => result.current.api.show("Queue sync needs attention", { variant: "warning" }));
    act(() => result.current.api.show("Copied", { variant: "success" }));
    expect(recorded).toEqual([
      expect.objectContaining({
        source: "toast",
        severity: "error",
        message: "Voice failed to start: Host is not connected",
      }),
      expect.objectContaining({
        source: "toast",
        severity: "warning",
        message: "Queue sync needs attention",
      }),
    ]);
  });
});
