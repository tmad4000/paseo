# Optional OpenAI voice

Implementation under review, not an installed-device acceptance claim. The running GPT voice interface and existing Paseo/desktop agents must remain untouched during development.

## Current model/API recommendation (2026-10-07)

For the first opt-in Paseo integration, use **GPT-Realtime-2.1 over the Realtime API**, keeping the existing coding agent as execution owner. This recommendation prioritizes explicit input commit/response controls, deterministic long-listening admission, existing native audio reuse, and auditable queue delivery. It is not a measured claim of superior voice quality. OpenAI describes 2.1 as improving alphanumeric recognition, silence/noise handling and interruption behavior over 2. The model has a 128K context window; increased reasoning effort can increase latency. [Model specification](https://developers.openai.com/api/docs/models/gpt-realtime-2.1).

The older VA3 `gpt-realtime-2` default is not the selection rationale. An isolated, no-audio live probe accepted the 2.1 session configuration, `gpt-transcribe` input transcription, server VAD and manual response creation. This proves account/configuration acceptance only.

| Architecture                                          | Suitability for this task                                                                      | Main tradeoff                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPT-Realtime-2.1 speech-to-speech                     | Conversational speech, tool handoff, explicit response scheduling; first implementation choice | Application owns playback cancellation/truncation, tool admission, durable continuity and reconnect. A second model interprets the conversation but never becomes the coding agent.                                                                                                                              |
| GPT-Live 1 with **client delegation**                 | Strong future candidate for simultaneous listening/speaking while the existing backend works   | Different session/delegation lifecycle; transcript fragments and delegation metadata require application reconciliation. The explicit “no speech/no task until end listening” contract needs its own tested gate. Responses delegation would introduce a different backend owner and is not the chosen workflow. |
| Transcription → existing coding agent → speech output | Best fit when exact text inspection and a single reasoning/task owner dominate                 | More stages between speech and useful spoken answer; application must implement barge-in and preserve word/turn boundaries. It retains agent semantics most directly.                                                                                                                                            |

OpenAI explicitly distinguishes these three architectures and recommends measuring useful-answer latency and task correctness separately. GPT-Live client delegation can retain any existing agent/service; its delegation event does not contain the user task text. [Voice architecture guide](https://developers.openai.com/api/docs/guides/voice-agents), [client delegation](https://developers.openai.com/api/docs/guides/live-delegation).

### Timing, listening and interruption

Server VAD detects silence; semantic VAD estimates whether an utterance is complete and supports eagerness settings. Semantic `low` can reduce premature conversational turns, but neither mode means “wait indefinitely for my explicit command.” The first integration uses server VAD to produce ordered transcription segments while disabling automatic responses. Listen mode stores segments without speech or task admission; explicit end waits for final transcription before one immutable queue request. Barge-in cancels voice playback/model response, never agent work. [VAD controls](https://developers.openai.com/api/docs/guides/realtime-vad).

For a transcription-only variant, OpenAI currently recommends `gpt-live-transcribe` for incremental text; it requires manual commits and does not support server/semantic VAD. `gpt-transcribe` supports transcription after committed turns over WebSocket and can use earlier transcribed turns as context. Transcription completion can arrive out of order, so item IDs matter. No accuracy winner is claimed without Jacob's names, code terms, accents and actual microphone recordings. [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).

### Transport and context

OpenAI recommends WebRTC for direct browser/mobile media. Its supported server-side WebSocket path keeps the standard key on the backend. This implementation reuses Paseo's existing encrypted client-to-host PCM transport and connects **only the host** to OpenAI. It avoids a new native WebRTC dependency; the extra host hop and TCP head-of-line blocking are costs to measure. A later direct media path must use ephemeral client secrets or server-mediated SDP, never the standard key in app code. [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime), [WebSocket](https://developers.openai.com/api/docs/guides/voice-websockets?api=realtime).

Voice transcripts/drafts belong to durable host context, not the temporary model connection. Resume restores a bounded recent tail and explicitly reports omitted history. Clear retains the old voice epoch and leaves agent context/work untouched. Full long-history summarization/retrieval is a separate acceptance item; a tail is not complete semantic recall. Reconnect does not replay admitted tasks or silently reopen cloud capture.

### Cost

Published prices at this review: Realtime 2.1 audio input $32/M tokens, cached input $0.40/M, output $64/M; text input $4/M and output $24/M. GPT-Live 1 costs $0.05 per session minute, plus backend/tool usage. Transcription estimates: `gpt-live-transcribe` $0.017/minute, `gpt-transcribe` $0.0045/minute. These billing bases differ: do not compare session minutes with token rates as if they were equal. Always add existing coding-agent costs. [Current pricing](https://developers.openai.com/api/docs/pricing).

A chained pipeline can reduce expensive speech-model reasoning, but introduces separate transcription/output charges and application latency. New work should not standardize on the legacy TTS/transcription models: OpenAI lists TTS shutdown January 6, 2027 and older Whisper/4o transcription shutdown February 26, 2027. Its listed TTS replacement is `gpt-realtime-2.1-mini`. Existing Paseo fallback is retained rather than silently migrated. [Deprecations](https://developers.openai.com/api/docs/deprecations).

### Required evaluation before claiming “best”

Use the same utterances, microphone, network, agent task and playback hardware for each candidate. Measure median/p95 time to **useful audible answer**, interruption-to-silence delay, premature turn rate, names/numbers/code-token transcription errors, wrong-target and duplicate dispatch count, incomplete final segments, reconnect behavior, cost from actual usage and a foreground memory soak. Include long pauses and corrections, simultaneous agent completion, mute/unmute, app background/route changes and expired sessions. Synthetic state tests cannot establish acoustic echo cancellation, phone background capture or naturalness. No physical microphone testing is authorized implicitly by starting a build.

## UX: one voice button

There is no separate "Start GPT voice" panel. The composer's standard voice-mode button is the single entry point: pressing it starts GPT realtime when the host advertises `openaiRealtimeVoice`, and starts the host's own Paseo voice otherwise. The active session uses the same realtime overlay (status, volume meter, interrupt/mute/stop) for both providers; GPT sessions additionally show connecting/unavailable status and connection errors in that overlay, and suppress the host verbal-command hints that do not apply to cloud capture.

Hosts advertise `openaiRealtimeVoice` only when an OpenAI credential actually resolves, so a host without a key silently yields the Paseo-voice button, not an error. If a GPT start fails anyway (revoked key, connect timeout, race), the client falls back to starting Paseo voice in the same press. Because GPT voice converses beside a working agent (work requests are queued, never interrupting), the voice button stays available while the agent is running on GPT-capable hosts; Paseo-only old hosts keep the interrupt-first gate. Mid-session connection loss still pauses capture and preserves context without switching providers — the automatic fallback applies at start only.

The advanced realtime controls (listen-until-I-finish, clear voice context, focus agent directly) remain in the protocol (`voice.realtime.control.request`) but are not currently surfaced in the composer; reintroducing them belongs behind a compact affordance, not an explanatory panel.

## Runtime configuration and privacy

The host reads `OPENAI_API_KEY` or the explicitly configured `PASEO_OPENAI_REALTIME_API_KEY_FILE` in place. No default search across credential files; no key reaches app state or protocol. Jacob's established VA3 credential was found and verified safely, but production configuration was not changed.

GPT Microphone off stops capture; it cannot hear voice unmute. Use the button or OS accessibility control. No browser SpeechRecognition or wake-word detector is introduced. Network failures pause capture and preserve context, with no mid-session provider substitution.

Source ownership: `session/voice/openai-realtime.ts` owns cloud events; `realtime-context.ts` owns voice-only history; existing `VoiceSessions` owns socket leases and existing agent queue owns accepted work. UI target selection does not follow another tab invisibly. Direct focus sends finalized text to the displayed agent queue; assistant mode uses one bounded forwarding tool. Queue admission is not strict steer or task completion. End voice/clear/barging-in have no agent-cancel/reload capability.

## Delivery and operational limits

The admission ledger is written before dispatch. An acknowledged message is never resubmitted by the same voice request; an uncertain acknowledgement remains `unknown` and requires inspection of the existing agent queue. This is fail-closed delivery, not a claim of distributed exactly-once completion. Finalized long-listening paragraphs survive voice off, reconnect and host restart. Raw audio is not retained; interrupted or failed transcription can leave unconfirmed audio, which is disclosed on resume. Clear archives the old voice epoch and excludes it from subsequent model input while retaining admission receipts.

Realtime connections have a documented 60-minute maximum. Connection loss/expiry pauses microphone capture and offers explicit retry with the microphone off. “Listen until I finish” suppresses turn-based replies and dispatch; it cannot promise uninterrupted networking or operating-system background microphone access. [Session lifecycle and interruption](https://developers.openai.com/api/docs/guides/realtime-conversations).

No dependencies were added or updated. No running app was replaced, no daemon was restarted and no production configuration was migrated. Wake-word mode is separate scope. Visual device acceptance, physical microphone/echo tests, comparative latency/quality/cost benchmarks, and release activation remain required before a quality or deployment claim.
