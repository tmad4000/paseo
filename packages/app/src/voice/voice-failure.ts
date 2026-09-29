/**
 * Voice input problems the user can act on. Each kind has its own spoken phrase and panel
 * text, because each calls for a different response: repeat yourself, restart voice, check
 * the host, or check the microphone.
 */
export type VoiceFailureKind =
  /** A long utterance produced an empty transcript. Repeat it. */
  | "nothing-recognized"
  /** The recognizer returned no result before the host's deadline. Restart voice. */
  | "recognition-stalled"
  /** The host's recognizer errored. Restart voice. */
  | "recognition-failed"
  /** The host could not start local speech recognition, for example its model did not load. */
  | "recognition-unavailable"
  /** The connection to the host dropped. Input is paused until it reconnects. */
  | "host-disconnected"
  /** The device stopped delivering microphone audio. Voice stops. */
  | "microphone-lost";

/** Failures after which nothing the user says reaches the agent. */
export function isVoiceFailureBlocking(kind: VoiceFailureKind): boolean {
  return kind !== "nothing-recognized";
}

/** Host `voice_input_state.recognitionIssue` values. Unknown values are ignored. */
export function voiceFailureFromRecognitionIssue(issue: string): VoiceFailureKind | null {
  switch (issue) {
    case "nothing_recognized":
      return "nothing-recognized";
    case "timed_out":
      return "recognition-stalled";
    case "failed":
      return "recognition-failed";
    default:
      return null;
  }
}

/**
 * The same kind stays quiet this long after it was spoken, even if it cleared in between.
 * This bounds a flapping connection to one "Host disconnected" and one "Reconnected" per
 * window. A miss repeats sooner because each one follows a separate attempt by the user.
 */
const REANNOUNCE_AFTER_MS: Record<VoiceFailureKind, number> = {
  "nothing-recognized": 10_000,
  "recognition-stalled": 30_000,
  "recognition-failed": 30_000,
  "recognition-unavailable": 30_000,
  "host-disconnected": 30_000,
  "microphone-lost": 30_000,
};

/** A different kind this soon after an announcement is usually a consequence of it. */
const CASCADE_WINDOW_MS = 3_000;

interface Episode {
  kind: VoiceFailureKind;
  announced: boolean;
}

export interface VoiceFailureTracker {
  /** Records a failure. Returns true when it should be spoken now. */
  report(kind: VoiceFailureKind): boolean;
  /** Ends episodes. Returns the kinds whose episode had been spoken, for a recovery cue. */
  clear(kinds: readonly VoiceFailureKind[]): VoiceFailureKind[];
  /** The most recently reported failure that has not cleared. */
  current(): VoiceFailureKind | null;
  reset(): void;
}

/**
 * Speaks a failure once per episode. A repeat of an active kind stays silent until the
 * episode clears, so a failure repeating every few hundred milliseconds is announced once.
 */
export function createVoiceFailureTracker(now: () => number = Date.now): VoiceFailureTracker {
  // Insertion order is report order; the last entry is the one the panel shows.
  const episodes = new Map<VoiceFailureKind, Episode>();
  const lastAnnouncedAt = new Map<VoiceFailureKind, number>();
  let lastAnyAnnouncedAt = Number.NEGATIVE_INFINITY;

  return {
    report(kind) {
      const existing = episodes.get(kind);
      if (existing) {
        episodes.delete(kind);
        episodes.set(kind, existing);
        return false;
      }
      const at = now();
      const announce =
        at - (lastAnnouncedAt.get(kind) ?? Number.NEGATIVE_INFINITY) >= REANNOUNCE_AFTER_MS[kind] &&
        at - lastAnyAnnouncedAt >= CASCADE_WINDOW_MS;
      episodes.set(kind, { kind, announced: announce });
      if (announce) {
        lastAnnouncedAt.set(kind, at);
        lastAnyAnnouncedAt = at;
      }
      return announce;
    },

    clear(kinds) {
      const recovered: VoiceFailureKind[] = [];
      for (const kind of kinds) {
        const episode = episodes.get(kind);
        if (!episode) continue;
        episodes.delete(kind);
        if (episode.announced) recovered.push(kind);
      }
      return recovered;
    },

    current() {
      let latest: VoiceFailureKind | null = null;
      for (const kind of episodes.keys()) latest = kind;
      return latest;
    },

    reset() {
      episodes.clear();
      lastAnnouncedAt.clear();
      lastAnyAnnouncedAt = Number.NEGATIVE_INFINITY;
    },
  };
}
