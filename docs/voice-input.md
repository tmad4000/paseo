# Voice microphone commands

With local speech recognition, say **“mute microphone”** or **“unmute microphone”** as a separate short utterance. Wait for the confirmation tone before continuing. Mute plays two descending notes; unmute plays two ascending notes. The voice panel shows the persistent mute state, the command to resume, and the existing tappable microphone control.

The commands use ordinary STT vocabulary rather than a product wake word, whose spelling can vary in transcription. Only a complete utterance matches, ignoring case and sentence punctuation; mentioning the command inside dictation does not activate it. The recognizer also accepts “un mute microphone”. Commands are English even when the app UI uses another language.

## What muted means

This is an **agent input mute**, not a hardware microphone switch. Capture and the encrypted connection to the host stay active. On the host, local VAD continues listening and the already loaded local STT model checks short utterances for “unmute microphone”. Other speech is discarded: no transcript event, activity entry, spoken agent input, or barge-in interruption. Muting does not cancel an agent's existing work or silence its replies. Stop voice to stop microphone capture entirely.

Muted recognition uses a 750 ms onset buffer and bounds an utterance to six seconds; longer speech is discarded. It does not continuously decode partial transcripts while muted and does not load an additional model. A pause separates the unmute command from private conversation. Muted speech is never replayed after unmuting.

## When input fails

Silence during voice mode looks the same as the agent thinking, so every failure that stops speech from reaching the agent is spoken on the device and shown in the voice panel. The status line changes from “Microphone on” to “Not listening” while input is blocked.

| Failure                                                                | Spoken                                    | Detected by                                               |
| ---------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| About 1.3 s or more of detected speech transcribed to nothing          | “Didn't catch that.”                      | host, `recognitionIssue: "nothing_recognized"`            |
| The recognizer returned no final result within 10 s                    | “Recognition stalled.”                    | host, `"timed_out"`                                       |
| The recognizer errored, for example its worker process died            | “Recognition failed.”                     | host, `"failed"` (and `error` for verbal-command clients) |
| The host could not start recognition when voice started or reconnected | “Recognition unavailable.”                | app, `set_voice_mode` rejected                            |
| The connection to the host dropped                                     | “Host disconnected.”, then “Reconnected.” | app, session connection state                             |
| The capture device went away or the OS took the microphone             | “Microphone lost.”, then voice stops      | app, audio engine interruption or track `ended`           |

Each phrase follows a failure earcon: one buzzy tone gliding down for about a third of a second. The mute and speech-rate earcons are short runs of pure sine notes, so timbre, glide, and length each set it apart. The phrases ship with the app because they must play when the host is unreachable. They are Kokoro voice `bm_george`, not the agent's default voice, rendered by `packages/app/scripts/generate-voice-failure-phrases.mjs` into `voice-failure-phrases.mulaw.ts`. Rerun the script after changing a phrase.

A failure is spoken once per episode, `packages/app/src/voice/voice-failure.ts`. A repeat of an active failure stays silent until it clears: a recognized transcript clears misses and recognizer failures, and a successful reconnect clears everything. The same failure is not spoken again within 30 s even if it cleared in between (10 s for misses), and a different failure within 3 s of an announcement is shown but not spoken, since it is usually a consequence. A flapping connection therefore produces at most one “Host disconnected” and one “Reconnected” per 30 s. Muted misses are never reported; a stalled or failed recognizer is reported while muted because “unmute microphone” cannot be heard either.

A frozen host is only noticed when the client's connection heartbeat gives up, about 40–50 s after it stops answering.

## Ownership and compatibility

- `packages/server/src/server/session/voice/voice-session.ts` owns mute state and consumes commands before transcript logging or agent submission.
- `voice-turn-controller.ts` owns the bounded command audio and replaces lightweight recognition sessions when mute changes, rejecting delayed results from the previous session while retaining the loaded model.
- `packages/app/src/voice/voice-runtime.ts` keeps capture alive, synchronizes the tap control, preserves mute on reconnect, and plays local PCM earcons. A failed mute acknowledgement or a verbal-command recognizer `error` pauses uploads until voice restarts or the host reconnects.
- Optional `voice_input_state.recognitionIssue` is a string, not an enum, so a later host can add values that older apps ignore.
- `server_info.features.voiceVerbalMute` advertises support. A client opts in with optional `set_voice_mode.voiceCommandsEnabled`; the response enables it only with local STT and local turn detection. Cloud STT and old hosts retain the existing tap-only mute, with the verbal feature shown as unavailable.
- `voice.input.set_muted.request` / `.response` handle taps. Optional `voice_input_state.isMuted` synchronizes verbal transitions without introducing an outbound event old clients cannot parse.

Focused checks: voice session, recognition issue, command parser, turn controller, app voice runtime and failure tracker, and `packages/protocol/src/messages.voice-mute.test.ts`. No shared daemon restart is needed for these tests. Physical microphone recognition and acoustic echo behavior still need a device smoke test when deploying a new build.
