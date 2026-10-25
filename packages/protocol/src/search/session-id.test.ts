import { describe, expect, it } from "vitest";
import { matchesSessionIdQuery, parseSessionIdQuery, shortSessionId } from "./session-id.js";

const ID = "9b8394eb-de93-4c1a-8f3e-0123456789ab";

describe("session id queries", () => {
  it("recognizes short and full ids, with or without surrounding space or case", () => {
    expect(parseSessionIdQuery("9b8394eb")).toBe("9b8394eb");
    expect(parseSessionIdQuery("  9B8394EB-DE93-  ")).toBe("9b8394eb-de93-");
    expect(parseSessionIdQuery(ID)).toBe(ID);
  });

  it("leaves words and short fragments to ordinary search", () => {
    expect(parseSessionIdQuery("facade")).toBeNull();
    expect(parseSessionIdQuery("fix bug")).toBeNull();
    expect(parseSessionIdQuery("9b83")).toBeNull();
    expect(parseSessionIdQuery(`${ID}0`)).toBeNull();
  });

  it("matches by prefix only", () => {
    expect(matchesSessionIdQuery(ID, "9b8394eb")).toBe(true);
    expect(matchesSessionIdQuery(ID, "9b8394eb-de93")).toBe(true);
    expect(matchesSessionIdQuery(ID, ID)).toBe(true);
    expect(matchesSessionIdQuery(ID, "de934c1a")).toBe(false);
    expect(shortSessionId(ID)).toBe("9b8394eb");
  });
});
