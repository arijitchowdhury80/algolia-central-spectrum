import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATE,
  applyGate,
  evaluateHardGate,
  verifiedGatingViolations,
} from "../src/index.js";
import { makeJudgment } from "./helpers.js";

describe("evaluateHardGate", () => {
  it("does NOT trip when there are no violations", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 9),
      makeJudgment("referee", "referee", 9),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateHardGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(false);
  });

  it("TRIPS on a verified skeptic grounding violation and caps the score", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 9, [{ confidence: 0.9 }]),
      makeJudgment("referee", "referee", 9),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateHardGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(true);
    expect(outcome.triggeringViolations).toHaveLength(1);

    // A high prose score must be capped to the gate cap.
    expect(applyGate(9.5, outcome)).toBe(DEFAULT_GATE.cap);
  });

  it("does NOT trip on a LOW-confidence violation below the verified threshold", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 9, [{ confidence: 0.3 }]),
    ];
    const outcome = evaluateHardGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(false);
  });

  it("does NOT trip on a high-confidence UNVERIFIABLE flag (not-in-thin-sources)", () => {
    // The fix: a claim merely absent from partial sources must not cap the score.
    const panel = [
      makeJudgment("skeptic", "skeptic", 9, [{ confidence: 0.95, kind: "unverifiable" }]),
      makeJudgment("referee", "referee", 9),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateHardGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(false);
    expect(applyGate(9.5, outcome)).toBe(9.5); // not capped
  });

  it("TRIPS on a high-confidence CONTRADICTED flag (real fabrication)", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 9, [{ confidence: 0.95, kind: "contradicted" }]),
    ];
    const outcome = evaluateHardGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(true);
    expect(applyGate(9.5, outcome)).toBe(DEFAULT_GATE.cap);
  });

  it("counts an UNLABELLED violation as contradicted (safe default — still gates)", () => {
    const panel = [makeJudgment("skeptic", "skeptic", 9, [{ confidence: 0.9 }])];
    expect(evaluateHardGate(panel, DEFAULT_GATE).tripped).toBe(true);
  });

  it("ignores violations raised only by non-gating judges (advocate)", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 9),
      makeJudgment("advocate", "advocate", 9, [{ confidence: 0.95 }]),
    ];
    const verified = verifiedGatingViolations(panel, DEFAULT_GATE);
    expect(verified).toHaveLength(0);
    expect(evaluateHardGate(panel, DEFAULT_GATE).tripped).toBe(false);
  });

  it("can be disabled entirely", () => {
    const panel = [makeJudgment("skeptic", "skeptic", 9, [{ confidence: 1 }])];
    const outcome = evaluateHardGate(panel, {
      ...DEFAULT_GATE,
      groundingGateEnabled: false,
    });
    expect(outcome.tripped).toBe(false);
    expect(applyGate(9.5, outcome)).toBe(9.5);
  });

  it("applyGate keeps the score when it is already below the cap", () => {
    const panel = [makeJudgment("skeptic", "skeptic", 2, [{ confidence: 0.9 }])];
    const outcome = evaluateHardGate(panel, DEFAULT_GATE);
    expect(applyGate(2, outcome)).toBe(2); // already <= cap(3)
  });
});
