import { afterEach, describe, expect, it, vi } from "vitest";
import { installGlobalErrorDiagnostics } from "./global-handlers";
import { setClientDiagnosticSink } from "./record";

let uninstallSink: (() => void) | null = null;
afterEach(() => uninstallSink?.());

function capture() {
  const recorded: unknown[] = [];
  uninstallSink = setClientDiagnosticSink((input) => recorded.push(input));
  return recorded;
}

describe("installGlobalErrorDiagnostics", () => {
  it("records uncaught errors and still runs the previous React Native handler", () => {
    const recorded = capture();
    const previous = vi.fn();
    let handler: ((error: unknown, isFatal?: boolean) => void) | undefined = previous;
    const errorUtils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: typeof previous) => {
        handler = next;
      },
    };
    const uninstall = installGlobalErrorDiagnostics({ errorUtils, appVersion: "0.10.0" });
    const error = new TypeError("Cannot read properties of undefined");
    handler?.(error, true);
    expect(previous).toHaveBeenCalledWith(error, true);
    expect(recorded).toEqual([
      expect.objectContaining({
        source: "global",
        code: "TypeError",
        phase: "fatal",
        message: error,
        appVersion: "0.10.0",
      }),
    ]);
    uninstall();
    expect(handler).toBe(previous);
  });

  it("records window errors and unhandled rejections on web, and removes its listeners", () => {
    const recorded = capture();
    const listeners = new Map<string, (event: unknown) => void>();
    const target = {
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    const uninstall = installGlobalErrorDiagnostics({ target, appVersion: null });
    listeners.get("unhandledrejection")?.({ reason: new Error("request failed") });
    listeners.get("error")?.({ message: "Script error." });
    expect(recorded).toEqual([
      expect.objectContaining({ operation: "unhandledrejection" }),
      expect.objectContaining({ operation: "window.error", message: "Script error." }),
    ]);
    uninstall();
    expect(listeners.size).toBe(0);
  });
});
