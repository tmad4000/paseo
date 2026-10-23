# Client error diagnostics

An agent on the host can read the errors a person saw on their phone or desktop app. It can also
read GPT Realtime failures with their original cause, even when the device never received the
message.

Motivation: on 2026-10-22 a phone showed "GPT Realtime rejected an event (…)". Nothing on the host
recorded the code in the parentheses. `OpenAiRealtime` did not log failures, and the app only
showed a toast or overlay.

## Reading diagnostics

```bash
paseo diagnostics errors                  # newest 50, human-readable
paseo diagnostics errors --since 30m      # or 2h, 1d, or an ISO timestamp
paseo diagnostics errors --source host-voice --limit 200
paseo diagnostics errors --json           # full records for scripts and agents
```

Each record shows:

- when it occurred, and the repeat count with its first and last time;
- the source and severity;
- the device (label, platform, client id), or `host`;
- the redacted message;
- `code`, `operation`, `phase`, `agent` and app version, when known.

The daemon log also has one line per new diagnostic:

- `client_diagnostic_reported` for device reports;
- `host_voice_diagnostic` and `realtime_voice_failed` for host-side Realtime failures.

You can grep `~/.paseo/daemon.log` for these lines.

## What is captured

| Source       | Where                                                                                                                                                                                                  | Fields                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toast`      | Every error or warning toast with a text message (`toast-host.tsx`). This is the one place all user-visible error toasts pass through.                                                                 | message                                                                                                                                                  |
| `voice`      | Voice failure cues (`reportFailure`), host input errors, and each distinct GPT Realtime error the overlay shows (`voice-runtime.ts`).                                                                  | code (failure kind or `realtime_state_error` / `host_input_error`), operation, phase, agent, host                                                        |
| `rpc`        | Host requests that come back as an error or time out (`DaemonClient` `onRequestError`, wired in `host-runtime.ts`). Recorded as `warning`, because a failed request is not always shown to the person. | code, operation (request type), host                                                                                                                     |
| `global`     | Uncaught JavaScript errors (React Native global handler) and, on web/desktop, window errors and unhandled rejections.                                                                                  | error name, fatal or non-fatal                                                                                                                           |
| `host-voice` | Every `OpenAiRealtime.fail()` on the host, recorded before the user-facing message is forwarded.                                                                                                       | OpenAI `code`, `param`, `event_id`, last non-audio client event (`operation`), close code/reason, phase (`connection/responding/mode`), agent, client id |

## Delivery

- Devices queue diagnostics locally: persisted in AsyncStorage as `paseo-client-diagnostics`.
- Repeats of the same problem within 10 minutes are counted on one event. Numbers are ignored when matching.
- The queue keeps at most 200 events and drops events older than 7 days.
- On every connection to a host that advertises `clientDiagnostics`, the device sends what it holds in batches of up to 50. New diagnostics also go to a connected host within about 2 seconds.
- Each event has a stable id. The host dedupes retries and merges a higher repeat count, so a lost acknowledgement never creates duplicates.
- The device forgets an event only after the host acknowledges it.
- Diagnostics tied to a host go only to that host. Untied ones, such as toasts, go to the first capable host that connects.
- Recordings made before the app finishes loading its saved queue are buffered and replayed. The saved queue is never overwritten.

## Bounds on the host

- Stored in `PASEO_HOME/diagnostics/client-errors.json` (atomic writes, persisted about 1 second after a change).
- Retention: the newest 1,000 events, up to 14 days, at most 1 MiB serialized.
- Rate limit: 120 new events per reporter per 10 minutes. Excess events are **deferred**, not dropped: the device keeps them and retries later, and `paseo diagnostics errors` reports the count.
- The daemon log gets one line per accepted new event. Merged repeats are not logged again, which keeps log growth small.

## Privacy

Diagnostics are metadata about errors, never content.

- No request bodies, prompts, transcripts, audio or attachments are recorded.
- Realtime causes carry the OpenAI error `param` (the field name), never its value.
- Every text field is redacted on the device **and** again on the host (`redactDiagnosticText` in `@getpaseo/protocol/client-diagnostics`):
  - authorization headers and bearer tokens;
  - provider keys (OpenAI-style, GitHub, Slack);
  - JWTs and `token=`/`password:`-style values;
  - secret URL query parameters;
  - any 64+ character base64/hex run (encoded audio or blobs).
- Messages are capped at 500 characters and identifiers at 120.

Redaction is best effort. Code that records a diagnostic must still never pass content as the message.

## Limitations

- Errors from before this feature, and errors on an app or host version without it, cannot be recovered.
- A device that never reconnects to the host never delivers what it saw. Its queue is bounded at 200 events and 7 days.
- Native crashes that kill the process before JavaScript runs, and iOS audio-session interruptions that never surface as an error, are not captured. The interruption gap is tracked separately (pspin-w6s).
- React Native unhandled promise rejections are not hooked on iOS/Android. Web and desktop are covered.
- Toasts whose content is not plain text are not recorded.
- `rpc` diagnostics include expected failures, such as feature probes on older hosts. They are coalesced and marked `warning`.
- OpenAI does not name the rejected client event unless the client set an `event_id`, which Paseo does not. `operation` therefore records the most recent non-audio event Paseo sent, which is the likely culprit, not a certainty.

## Tests

- Protocol: `client-diagnostics.test.ts` covers redaction, field limits, fingerprints and the schema.
- Server:
  - `client-diagnostics/store.test.ts` covers dedupe and merge, the rate limit, count/age/size bounds, restart persistence, filters, host records, server-side redaction and the log line.
  - `session/voice/openai-realtime.test.ts` covers rejection code/param/event id/last operation, close code and reason, processing errors, and a throwing reporter.
  - `client-diagnostics.e2e.test.ts` runs a real daemon round trip: report, retry merge, redaction, then readback from another client. It is part of `test:integration`.
- App:
  - `diagnostics/client-errors/model.test.ts` covers coalescing, bounds, age, redaction, host targeting and acknowledgement.
  - `store.test.ts` covers early recordings, restart while offline, flush on reconnect, deferred and failed reports, and one flush per host.
  - `global-handlers.test.ts`, `components/toast-host.diagnostics.test.tsx` and `voice/voice-runtime.test.ts` (voice failure diagnostics) cover the capture points.
- CLI: `commands/diagnostics/errors.test.ts` covers rendering and `--since`.
