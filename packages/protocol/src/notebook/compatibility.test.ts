import { describe, expect, it } from "vitest";
import { ServerInfoStatusPayloadSchema } from "../messages.js";

describe("work notebook capability compatibility", () => {
  it("accepts an older server-info payload with no work-notebook capability", () => {
    const result = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "older-daemon",
      features: {},
    });

    expect(result.features?.workNotebook).toBeUndefined();
  });

  it("accepts a server-info payload advertising work-notebook support", () => {
    const result = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "new-daemon",
      features: { workNotebook: true },
    });

    expect(result.features?.workNotebook).toBe(true);
  });
});
