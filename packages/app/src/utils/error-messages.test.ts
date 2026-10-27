import { describe, expect, it } from "vitest";
import { isConnectionErrorMessage, toDisplayErrorMessage } from "./error-messages";

describe("isConnectionErrorMessage", () => {
  it.each([
    "Transport not connected (status: reconnecting)",
    "Transport disconnected before connect",
    "fetch_agent_timeline timed out (15000ms)",
    "Timed out waiting for agent abc123",
    "History sync timed out after 15s",
    "WebSocket not open (readyState=3)",
    "Encrypted channel not ready",
    "Daemon client closed",
    "Daemon client is disposed",
    "Host srv_123 is not connected",
    "TypeError: Failed to fetch",
    "Network request failed",
    "read ECONNRESET",
    "Failed to send: Transport not connected (status: reconnecting)",
  ])("treats %j as a connection failure", (message) => {
    expect(isConnectionErrorMessage(message)).toBe(true);
  });

  it.each([
    "A queued message cannot be empty.",
    "This queued message changed on another device. Review it and try again.",
    "Failed to send message",
    "Model not found",
    "",
  ])("leaves %j alone", (message) => {
    expect(isConnectionErrorMessage(message)).toBe(false);
  });
});

describe("toDisplayErrorMessage", () => {
  it("explains connection failures in plain language", () => {
    const shown = toDisplayErrorMessage("Transport not connected (status: disconnected)");
    expect(shown).not.toContain("Transport");
    expect(shown.length).toBeGreaterThan(0);
  });

  it("keeps the caller's context prefix", () => {
    const shown = toDisplayErrorMessage(
      "Failed to load history: Transport not connected (status: idle)",
    );
    expect(shown.startsWith("Failed to load history: ")).toBe(true);
    expect(shown).not.toContain("Transport");
  });

  it("passes other messages through unchanged", () => {
    expect(toDisplayErrorMessage("Model not found")).toBe("Model not found");
  });
});
