import { describe, it, expect } from "vitest";
import { API_KEY_HEADER, API_KEY_HEADER_ALT, isAuthorized, safeEqual } from "./auth.js";

/**
 * The alias case is the reason this file exists. The vendored Algolia chat
 * widget sends the shared secret as `x-judge-api-key`; our own web client sends
 * it as `x-lab-key`. Probed against the deployed judge on 2026-07-28, the
 * widget's header alone returned 401 — which would have shown up in the demo as
 * a permanently dark "auth required" chip. Both envelopes now carry the same
 * key, and these tests pin that the gate itself did not get looser.
 */
describe("isAuthorized", () => {
  it("accepts the primary header", () => {
    expect(isAuthorized("secret", "secret")).toBe(true);
  });

  it("accepts the alternate header when the primary is absent", () => {
    expect(isAuthorized(undefined, "secret", "secret")).toBe(true);
  });

  it("still rejects a wrong key in the alternate header", () => {
    expect(isAuthorized(undefined, "secret", "nope")).toBe(false);
  });

  it("rejects when neither header is present", () => {
    expect(isAuthorized(undefined, "secret", undefined)).toBe(false);
  });

  it("rejects an empty value in both headers", () => {
    expect(isAuthorized("", "secret", "")).toBe(false);
  });

  it("prefers the primary header when both are sent", () => {
    expect(isAuthorized("secret", "secret", "wrong")).toBe(true);
    expect(isAuthorized("wrong", "secret", "secret")).toBe(false);
  });

  it("reads the first value when node hands back a repeated header array", () => {
    expect(isAuthorized(undefined, "secret", ["secret", "other"])).toBe(true);
  });

  it("leaves the gate OPEN when no key is configured (local dev)", () => {
    expect(isAuthorized(undefined, undefined)).toBe(true);
    expect(isAuthorized(undefined, "", "")).toBe(true);
  });

  it("uses distinct, lowercase header names (node lowercases incoming keys)", () => {
    expect(API_KEY_HEADER).toBe("x-lab-key");
    expect(API_KEY_HEADER_ALT).toBe("x-judge-api-key");
    expect(API_KEY_HEADER).not.toBe(API_KEY_HEADER_ALT);
  });
});

describe("safeEqual", () => {
  it("is false for different lengths without comparing content", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("is true only for an exact match", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});
