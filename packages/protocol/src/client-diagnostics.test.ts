import { describe, expect, it } from "vitest";
import {
  ClientDiagnosticEventSchema,
  CLIENT_DIAGNOSTIC_MESSAGE_MAX,
  diagnosticFingerprint,
  redactDiagnosticField,
  redactDiagnosticText,
} from "./client-diagnostics.js";

describe("redactDiagnosticText", () => {
  it("keeps the readable cause of a GPT Realtime rejection", () => {
    const message =
      "GPT Realtime rejected an event (conversation_already_has_active_response: Conversation already has an active response in progress). Microphone paused; retry or explicitly choose Paseo voice.";
    expect(redactDiagnosticText(message, 1000)).toBe(message);
  });

  it("removes bearer tokens, authorization headers and provider keys", () => {
    const text = redactDiagnosticText(
      "401 from upstream; Authorization: Bearer sk-proj-abcdefghijklmnop1234 and key sk-live_ABCDEFGHIJ12345 ghp_abcdefghijklmnopqrstu xoxb-1234567890-abcdef",
    );
    expect(text).not.toMatch(/sk-proj-abcdefghijklmnop1234|sk-live_ABCDEFGHIJ12345/);
    expect(text).not.toMatch(/ghp_abcdefghijklmnopqrstu|xoxb-1234567890-abcdef/);
    expect(text).toContain("401 from upstream");
    expect(text).toContain("[redacted");
  });

  it("removes JWTs, key=value secrets and secret query parameters", () => {
    const text = redactDiagnosticText(
      'token=abc123def password: "hunter2 hunter3" https://x.test/cb?code=SECRETCODE&state=ok eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.c2lnbmF0dXJlX2hlcmU',
    );
    expect(text).not.toMatch(/abc123def|hunter2|SECRETCODE|eyJhbGciOiJIUzI1/);
    expect(text).toContain("state=ok");
  });

  it("drops encoded audio and other long blobs instead of passing them through", () => {
    const audio = Buffer.alloc(300, 7).toString("base64");
    const text = redactDiagnosticText(`Invalid voice audio chunk ${audio}`);
    expect(text).toBe("Invalid voice audio chunk [redacted-blob]");
  });

  it("collapses whitespace, truncates long text and accepts Error objects", () => {
    expect(redactDiagnosticText(new Error("  two\n\nlines  "))).toBe("two lines");
    const long = redactDiagnosticText("word ".repeat(400));
    expect(long.length).toBe(CLIENT_DIAGNOSTIC_MESSAGE_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(redactDiagnosticText({ not: "text" })).toBe("");
  });
});

describe("redactDiagnosticField", () => {
  it("normalizes short identifiers and drops empty values", () => {
    expect(redactDiagnosticField("response.create")).toBe("response.create");
    expect(redactDiagnosticField(1006)).toBe("1006");
    expect(redactDiagnosticField("   ")).toBeUndefined();
    expect(redactDiagnosticField(undefined)).toBeUndefined();
    expect(redactDiagnosticField("op ".repeat(200))?.length).toBe(120);
    // A long unbroken run is treated as an encoded blob before it is truncated.
    expect(redactDiagnosticField("x".repeat(500))).toBe("[redacted-blob]");
  });
});

describe("diagnosticFingerprint", () => {
  it("treats messages differing only by numbers as the same problem", () => {
    const base = {
      source: "rpc",
      severity: "warning",
      code: "timeout",
      operation: "fetch",
    } as const;
    expect(diagnosticFingerprint({ ...base, message: "Timed out after 5000ms (retry 3)" })).toBe(
      diagnosticFingerprint({ ...base, message: "Timed out after 7000ms (retry 4)" }),
    );
    expect(diagnosticFingerprint({ ...base, message: "a" })).not.toBe(
      diagnosticFingerprint({ ...base, code: "rpc_error", message: "a" }),
    );
  });
});

describe("ClientDiagnosticEventSchema", () => {
  it("rejects unknown sources so devices cannot invent categories", () => {
    const event = {
      id: "cd-1",
      occurredAt: "2026-10-22T22:52:30.000Z",
      count: 1,
      source: "voice",
      severity: "error",
      message: "Voice failure: microphone-lost",
    };
    expect(ClientDiagnosticEventSchema.safeParse(event).success).toBe(true);
    expect(ClientDiagnosticEventSchema.safeParse({ ...event, source: "made-up" }).success).toBe(
      false,
    );
  });
});
