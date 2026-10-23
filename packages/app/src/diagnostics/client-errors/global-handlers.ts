import { recordClientDiagnostic } from "./record";

interface ErrorUtilsLike {
  getGlobalHandler(): ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

interface WindowLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error && error.name !== "Error" ? error.name : undefined;
}

/**
 * Records uncaught JavaScript errors (React Native's global handler) and, on web/desktop,
 * window errors and unhandled promise rejections. The previous handlers still run unchanged.
 * Native crashes that kill the process before JavaScript runs are not captured.
 */
export function installGlobalErrorDiagnostics(input: {
  errorUtils?: ErrorUtilsLike | null;
  target?: WindowLike | null;
  appVersion: string | null;
}): () => void {
  const cleanups: Array<() => void> = [];
  const errorUtils = input.errorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      recordClientDiagnostic({
        source: "global",
        severity: "error",
        message: error,
        code: errorName(error),
        phase: isFatal ? "fatal" : "non-fatal",
        appVersion: input.appVersion,
      });
      previous?.(error, isFatal);
    });
    cleanups.push(() => {
      if (previous) errorUtils.setGlobalHandler(previous);
    });
  }
  const target = input.target;
  if (target) {
    const onError = (event: unknown) => {
      const error = (event as { error?: unknown; message?: unknown }).error;
      recordClientDiagnostic({
        source: "global",
        severity: "error",
        message: error ?? (event as { message?: unknown }).message,
        code: errorName(error),
        operation: "window.error",
        appVersion: input.appVersion,
      });
    };
    const onRejection = (event: unknown) => {
      const reason = (event as { reason?: unknown }).reason;
      recordClientDiagnostic({
        source: "global",
        severity: "error",
        message: reason instanceof Error ? reason : String(reason),
        code: errorName(reason),
        operation: "unhandledrejection",
        appVersion: input.appVersion,
      });
    };
    target.addEventListener("error", onError);
    target.addEventListener("unhandledrejection", onRejection);
    cleanups.push(() => {
      target.removeEventListener("error", onError);
      target.removeEventListener("unhandledrejection", onRejection);
    });
  }
  return () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
}
