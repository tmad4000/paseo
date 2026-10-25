import type { ClientDiagnosticInput } from "./model";

/**
 * The one entry point for client error diagnostics. Callers (toasts, voice, host requests,
 * uncaught errors) record here; the persisted queue registers itself as the sink at startup.
 * Kept free of storage imports so any module can record without side effects in tests.
 */

type Sink = (input: ClientDiagnosticInput) => void;

const EARLY_BUFFER_MAX = 50;
let sink: Sink | null = null;
const early: ClientDiagnosticInput[] = [];

export function recordClientDiagnostic(input: ClientDiagnosticInput): void {
  try {
    if (sink) {
      sink(input);
      return;
    }
    if (early.length >= EARLY_BUFFER_MAX) early.shift();
    early.push(input);
  } catch {
    // Recording a diagnostic must never break the code path that hit the error.
  }
}

/** Installs the sink and replays anything recorded before it existed. Returns an uninstaller. */
export function setClientDiagnosticSink(next: Sink | null): () => void {
  sink = next;
  if (next) {
    for (const input of early.splice(0)) {
      try {
        next(input);
      } catch {
        // Same rule as recordClientDiagnostic.
      }
    }
  }
  return () => {
    if (sink === next) sink = null;
  };
}
