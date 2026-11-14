import type { DraftInput } from "@/stores/draft-store/state";

/** Live text is read by editing consumers; containers subscribe only to what they display. */
export interface ComposerTextSource {
  getRevision?: () => unknown;
  getDraftSnapshot?: () => DraftInput;
  getSnapshot: () => string;
  subscribe: (listener: () => void) => () => void;
}
