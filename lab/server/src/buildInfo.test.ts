import { describe, it, expect } from "vitest";
import { getBuildInfo, healthPayload } from "./buildInfo.js";

describe("getBuildInfo", () => {
  it("reads GIT_SHA and BUILT_AT from the given env", () => {
    expect(getBuildInfo({ GIT_SHA: "abc123", BUILT_AT: "2026-07-19T00:00:00.000Z" })).toEqual({
      sha: "abc123",
      builtAt: "2026-07-19T00:00:00.000Z",
    });
  });

  it("falls back to \"unknown\" when unset — e.g. local dev with no build step", () => {
    expect(getBuildInfo({})).toEqual({ sha: "unknown", builtAt: "unknown" });
  });

  it("treats an empty string the same as unset", () => {
    expect(getBuildInfo({ GIT_SHA: "", BUILT_AT: "" })).toEqual({ sha: "unknown", builtAt: "unknown" });
  });
});

describe("healthPayload", () => {
  it("merges ok:true with the build info so /health is one round trip", () => {
    expect(healthPayload({ GIT_SHA: "deadbeef", BUILT_AT: "2026-07-19T12:00:00.000Z" })).toEqual({
      ok: true,
      sha: "deadbeef",
      builtAt: "2026-07-19T12:00:00.000Z",
    });
  });
});
