/**
 * Why a finished utterance produced no text, when the user should hear about it. Sent as
 * `voice_input_state.recognitionIssue`; the app speaks and shows each one.
 */
export type VoiceRecognitionIssue = "nothing_recognized" | "timed_out" | "failed";

/**
 * Detector time from speech start to speech stop. The local detector confirms speech 800 ms
 * after onset and ends it after 1 s of silence, so this is about 1.3 s of actual speech.
 * Shorter utterances that transcribe to nothing are usually coughs, clicks, or noise.
 */
export const NOTHING_RECOGNIZED_MIN_SPEECH_MS = 1500;

export function resolveVoiceRecognitionIssue(input: {
  transcript: string;
  speechMs: number;
  timedOut: boolean;
  inputMuted: boolean;
}): VoiceRecognitionIssue | null {
  if (input.transcript.length > 0) return null;
  // A recognizer that does not answer also cannot hear "unmute microphone", so report it muted too.
  if (input.timedOut) return "timed_out";
  if (input.inputMuted || input.speechMs < NOTHING_RECOGNIZED_MIN_SPEECH_MS) return null;
  return "nothing_recognized";
}
