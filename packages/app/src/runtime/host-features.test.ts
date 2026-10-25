import { describe, expect, it } from "vitest";
import type { DaemonServerInfo } from "@/stores/session-store";
import { everyHostLacksFeature, hostFeatureAvailability } from "./host-features";

const OLDER_HOST: DaemonServerInfo = {
  serverId: "srv",
  hostname: "SDMM770",
  version: "0.10.0-beta.11",
  features: { durableStream: false },
};

describe("hostFeatureAvailability", () => {
  it("is unknown until the host's server info arrives", () => {
    expect(hostFeatureAvailability(null, "durableStream")).toBeNull();
    expect(hostFeatureAvailability(undefined, "durableStream")).toBeNull();
  });

  it("reports a connected host's advertised flag", () => {
    expect(hostFeatureAvailability(OLDER_HOST, "durableStream")).toBe(false);
    expect(hostFeatureAvailability({ ...OLDER_HOST, features: undefined }, "durableStream")).toBe(
      false,
    );
    expect(
      hostFeatureAvailability(
        { ...OLDER_HOST, features: { durableStream: true } },
        "durableStream",
      ),
    ).toBe(true);
  });
});

describe("everyHostLacksFeature", () => {
  it("needs every host known and without the feature", () => {
    expect(everyHostLacksFeature(new Map([["a", false]]))).toBe(true);
    expect(
      everyHostLacksFeature(
        new Map([
          ["a", false],
          ["b", false],
        ]),
      ),
    ).toBe(true);
  });

  it("does not treat an unknown host or an empty host list as older", () => {
    expect(everyHostLacksFeature(new Map())).toBe(false);
    expect(everyHostLacksFeature(new Map([["a", null]]))).toBe(false);
    expect(
      everyHostLacksFeature(
        new Map([
          ["a", false],
          ["b", null],
        ]),
      ),
    ).toBe(false);
    expect(
      everyHostLacksFeature(
        new Map([
          ["a", false],
          ["b", true],
        ]),
      ),
    ).toBe(false);
  });
});
