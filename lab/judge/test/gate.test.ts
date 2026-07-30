import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATE,
  applyGate,
  evaluateCorroborationGate,
  gateEligibleFlags,
} from "../src/index.js";
import { makeJudgment } from "./helpers.js";
import type { GroundingViolation, Judgment } from "../src/index.js";

/** Build a Judgment with a custom groundingViolations list (bypassing makeJudgment's shape). */
function judgmentWithViolations(
  judgeId: string,
  temperament: "skeptic" | "referee" | "advocate",
  score: number,
  violations: GroundingViolation[],
): Judgment {
  return { ...makeJudgment(judgeId, temperament, score), groundingViolations: violations };
}

function violation(overrides: Partial<GroundingViolation> = {}): GroundingViolation {
  return {
    claim: "the sky is green",
    reason: "not in sources",
    certainty: 0.9,
    kind: "contradicted",
    sourceId: "",
    excerpt: "",
    ...overrides,
  };
}

describe("gateEligibleFlags (§3.2 rules 1-3)", () => {
  it("drops kind=unverifiable when gateOnUnverifiable is off (rule 1, legacy mode)", () => {
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ kind: "unverifiable" })]),
    ];
    const legacy = { ...DEFAULT_GATE, gateOnUnverifiable: false };
    expect(gateEligibleFlags(panel, legacy)).toHaveLength(0);
  });

  /**
   * 2026-07-28 behaviour change. Absence-from-corpus is the actual hallucination
   * shape — invented content asserts what the docs never mention rather than
   * contradicting them — so the default gate now admits it. Previously excluded
   * only because truncated sources made supported claims look unverifiable.
   */
  it("admits kind=unverifiable by default, above the higher confidence bar", () => {
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ kind: "unverifiable", certainty: 0.9 }),
      ]),
    ];
    expect(gateEligibleFlags(panel, DEFAULT_GATE)).toHaveLength(1);
  });

  it("holds unverifiable to a HIGHER bar than contradicted", () => {
    // 0.75 clears verifiedConfidence (0.7) but not unverifiableConfidence (0.8).
    const mid = 0.75;
    const unver = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ kind: "unverifiable", certainty: mid }),
      ]),
    ];
    const contra = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ kind: "contradicted", certainty: mid }),
      ]),
    ];
    expect(gateEligibleFlags(unver, DEFAULT_GATE)).toHaveLength(0);
    expect(gateEligibleFlags(contra, DEFAULT_GATE)).toHaveLength(1);
  });

  it("drops certainty below verifiedConfidence (rule 2)", () => {
    const panel = [judgmentWithViolations("skeptic", "skeptic", 9, [violation({ certainty: 0.5 })])];
    expect(gateEligibleFlags(panel, DEFAULT_GATE)).toHaveLength(0);
  });

  it("keeps a pure fabrication (empty excerpt) as eligible (rule 3, allowed path)", () => {
    const panel = [judgmentWithViolations("skeptic", "skeptic", 9, [violation({ excerpt: "" })])];
    expect(gateEligibleFlags(panel, DEFAULT_GATE)).toHaveLength(1);
  });

  it("keeps a verified non-empty excerpt as eligible", () => {
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ sourceId: "S1", excerpt: "the sky is blue", excerptVerified: true }),
      ]),
    ];
    expect(gateEligibleFlags(panel, DEFAULT_GATE)).toHaveLength(1);
  });

  it("demotes a non-empty excerpt that FAILED verification (rule 3, anti-hallucination guard)", () => {
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ sourceId: "S1", excerpt: "the sky is blue", excerptVerified: false }),
      ]),
    ];
    expect(gateEligibleFlags(panel, DEFAULT_GATE)).toHaveLength(0);
  });
});

describe("evaluateCorroborationGate", () => {
  it("does NOT trip when there are no violations", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 9),
      makeJudgment("referee", "referee", 9),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(false);
    expect(outcome.borderline).toBe(false);
  });

  it("does NOT trip on a SOLO skeptic flag — the 9/9/9->3.10 bug fix (a)", () => {
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim: "isQuiet was removed" })]),
      makeJudgment("referee", "referee", 9),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(false);
    expect(outcome.soloFlags).toHaveLength(1);
    expect(outcome.borderline).toBe(true);
    expect(applyGate(9.5, outcome)).toBe(9.5); // not capped
  });

  it("TRIPS when 2 distinct judges independently flag the SAME claim (a)", () => {
    const claim = "isQuiet and elementType are no longer supported";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim })]),
      judgmentWithViolations("referee", "referee", 9, [violation({ claim })]),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(true);
    expect(outcome.corroboratedClusters).toHaveLength(1);
    expect([...outcome.corroboratedClusters[0].judgeIds].sort()).toEqual(["referee", "skeptic"]);
    expect(applyGate(9.5, outcome)).toBe(DEFAULT_GATE.cap);
  });

  it("TRIPS when all 3 judges flag the same claim", () => {
    const claim = "Props like isQuiet were removed from several components in S2";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim })]),
      judgmentWithViolations("referee", "referee", 9, [violation({ claim })]),
      judgmentWithViolations("advocate", "advocate", 9, [violation({ claim })]),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(true);
    expect(outcome.corroboratedClusters[0].judgeIds).toHaveLength(3);
  });

  it("does NOT trip when 2 judges flag DIFFERENT (dissimilar) claims — heterogeneous, not corroborated", () => {
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ claim: "vector search compares numeric embeddings" }),
      ]),
      judgmentWithViolations("referee", "referee", 9, [
        violation({ claim: "facetFilters restrict results to selected refinements" }),
      ]),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(false);
    expect(outcome.soloFlags).toHaveLength(2);
  });

  it("(c) kind=unverifiable never gates in legacy mode, even with 3-judge agreement", () => {
    const claim = "PUMA saw a 15% increase in conversion";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim, kind: "unverifiable" })]),
      judgmentWithViolations("referee", "referee", 9, [violation({ claim, kind: "unverifiable" })]),
      judgmentWithViolations("advocate", "advocate", 9, [violation({ claim, kind: "unverifiable" })]),
    ];
    const outcome = evaluateCorroborationGate(panel, {
      ...DEFAULT_GATE,
      gateOnUnverifiable: false,
    });
    expect(outcome.tripped).toBe(false);
    expect(outcome.soloFlags).toHaveLength(0);
  });

  it("(c2) kind=unverifiable DOES gate by default when corroborated", () => {
    const claim = "ActionButton is ideal for toolbars";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ claim, kind: "unverifiable", certainty: 0.9 }),
      ]),
      judgmentWithViolations("referee", "referee", 9, [
        violation({ claim, kind: "unverifiable", certainty: 0.85 }),
      ]),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(true);
  });

  /**
   * The 9/9/9 -> 3.10 regression guard, restated for the widened gate: opening
   * the door to unverifiable must NOT reopen the solo-flag hole. Corroboration
   * (2 of 3) is the protection, and it still applies.
   */
  it("(c3) a SOLO unverifiable flag still cannot gate", () => {
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ claim: "lone skeptic gripe", kind: "unverifiable", certainty: 0.95 }),
      ]),
      makeJudgment("referee", "referee", 9),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(false);
    expect(outcome.soloFlags).toHaveLength(1);
  });

  it("(d) certainty below verifiedConfidence never gates, even with 3-judge agreement", () => {
    const claim = "some low-confidence shared claim";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim, certainty: 0.4 })]),
      judgmentWithViolations("referee", "referee", 9, [violation({ claim, certainty: 0.5 })]),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(false);
  });

  it("(e) a non-empty excerpt with excerptVerified:false is demoted — does not corroborate", () => {
    const claim = "S8 mentions Trays as alternatives";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ claim, sourceId: "S8", excerpt: "mentions Trays as alternatives", excerptVerified: false }),
      ]),
      judgmentWithViolations("referee", "referee", 9, [
        violation({ claim, sourceId: "S8", excerpt: "mentions Trays as alternatives", excerptVerified: false }),
      ]),
      makeJudgment("advocate", "advocate", 9),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(false);
  });

  it("(f) empty excerpt (fabrication) stays eligible and can corroborate", () => {
    const claim = "Algolia guarantees a 42% conversion lift within 90 days";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim, excerpt: "" })]),
      judgmentWithViolations("advocate", "advocate", 9, [violation({ claim, excerpt: "" })]),
      makeJudgment("referee", "referee", 9),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(outcome.tripped).toBe(true);
  });

  it("(g) claimSimilarity boundary: clusters at >= threshold, doesn't below", () => {
    // Identical tokens (sim 1.0) → clusters and corroborates.
    const claim = "typo tolerance is applied during matching";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim })]),
      judgmentWithViolations("referee", "referee", 9, [violation({ claim })]),
      makeJudgment("advocate", "advocate", 9),
    ];
    expect(evaluateCorroborationGate(panel, DEFAULT_GATE).tripped).toBe(true);

    // Zero shared meaningful tokens (sim 0, below 0.5) → does not cluster, no corroboration.
    const panelDissimilar = [
      judgmentWithViolations("skeptic", "skeptic", 9, [
        violation({ claim: "typo tolerance is applied during matching" }),
      ]),
      judgmentWithViolations("referee", "referee", 9, [
        violation({ claim: "facetFilters restrict results to selected refinements" }),
      ]),
      makeJudgment("advocate", "advocate", 9),
    ];
    expect(evaluateCorroborationGate(panelDissimilar, DEFAULT_GATE).tripped).toBe(false);
  });

  it("can be disabled entirely", () => {
    const claim = "shared claim";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim })]),
      judgmentWithViolations("referee", "referee", 9, [violation({ claim })]),
    ];
    const outcome = evaluateCorroborationGate(panel, { ...DEFAULT_GATE, groundingGateEnabled: false });
    expect(outcome.tripped).toBe(false);
    expect(applyGate(9.5, outcome)).toBe(9.5);
  });

  it("applyGate keeps the score when it is already below the cap", () => {
    const claim = "shared claim";
    const panel = [
      judgmentWithViolations("skeptic", "skeptic", 2, [violation({ claim })]),
      judgmentWithViolations("referee", "referee", 2, [violation({ claim })]),
    ];
    const outcome = evaluateCorroborationGate(panel, DEFAULT_GATE);
    expect(applyGate(2, outcome)).toBe(2); // already <= cap(3)
  });
});

/**
 * Deterministic mode (decided 2026-07-28): only the verbatim search
 * may cap the served score; the LLM panel becomes advisory. These tests pin the
 * property that motivated the change — the number must not depend on what an
 * LLM guessed about absence — and the honesty property that a silent fallback
 * to the LLM path is impossible to hide.
 */
describe("evaluateCorroborationGate — deterministic mode", () => {
  const det = (grounded: boolean) =>
    grounded
      ? { checked: 5, unsupported: [], grounded: true }
      : {
          checked: 5,
          unsupported: [{ term: "allowsNonContiguousRanges", kind: "identifier" as const }],
          grounded: false,
        };

  const corroboratedPanel = [
    judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim: "shared claim" })]),
    judgmentWithViolations("referee", "referee", 9, [violation({ claim: "shared claim" })]),
  ];

  it("caps on an unsupported hard term even with ZERO llm flags", () => {
    const clean = [makeJudgment("skeptic", "skeptic", 9), makeJudgment("referee", "referee", 9)];
    const outcome = evaluateCorroborationGate(clean, DEFAULT_GATE, det(false));
    expect(outcome.tripped).toBe(true);
    expect(outcome.mode).toBe("deterministic");
    expect(applyGate(9.5, outcome)).toBe(DEFAULT_GATE.cap);
    expect(outcome.explanation).toContain("allowsNonContiguousRanges");
  });

  it("does NOT cap on a corroborated llm cluster — it becomes advisory", () => {
    const outcome = evaluateCorroborationGate(corroboratedPanel, DEFAULT_GATE, det(true));
    expect(outcome.tripped).toBe(false);
    expect(outcome.corroboratedClusters).toHaveLength(0); // nothing capped
    expect(outcome.advisoryClusters).toHaveLength(1); // ...but it is still reported
    expect(applyGate(9.5, outcome)).toBe(9.5);
  });

  it("is NEVER borderline on the deterministic path, even with llm evidence", () => {
    // Regression: a grounded answer scoring 9.3/10 with judges at 8.9/8.9/10.0
    // was labelled BORDERLINE in the live drawer, purely because one judge had
    // raised an advisory flag we had already decided not to count. There is no
    // threshold to be near here — a term is located in a source or it is not.
    const outcome = evaluateCorroborationGate(corroboratedPanel, DEFAULT_GATE, det(true));
    expect(outcome.borderline).toBe(false);
    // The advisory evidence is still reported — suppressed label, not suppressed finding.
    expect(outcome.advisoryClusters).toHaveLength(1);
    expect(outcome.explanation).toContain("advisory");
  });

  it("is not borderline on the deterministic path when the answer is UNGROUNDED either", () => {
    const outcome = evaluateCorroborationGate(corroboratedPanel, DEFAULT_GATE, det(false));
    expect(outcome.tripped).toBe(true);
    expect(outcome.borderline).toBe(false);
  });

  it("KEEPS borderline on the llm path, where a solo flag really is near the threshold", () => {
    // Guard against over-correcting: with no deterministic verdict the gate falls
    // back to the LLM path, and there "one more judge and it would have capped"
    // is a true statement worth surfacing.
    const solo = [
      judgmentWithViolations("skeptic", "skeptic", 9, [violation({ claim: "lone claim" })]),
      makeJudgment("referee", "referee", 9),
    ];
    const outcome = evaluateCorroborationGate(solo, DEFAULT_GATE);
    expect(outcome.mode).toBe("llm");
    expect(outcome.borderline).toBe(true);
  });

  it("carries the deterministic verdict through for the UI", () => {
    const outcome = evaluateCorroborationGate(corroboratedPanel, DEFAULT_GATE, det(false));
    expect(outcome.deterministic).toEqual(det(false));
  });

  it("falls back to the llm gate when no deterministic verdict is supplied, and SAYS so", () => {
    const outcome = evaluateCorroborationGate(corroboratedPanel, DEFAULT_GATE);
    expect(outcome.mode).toBe("llm");
    expect(outcome.tripped).toBe(true);
  });

  it("respects an explicit llm mode: the deterministic verdict is reported, not obeyed", () => {
    const llmMode = { ...DEFAULT_GATE, groundingMode: "llm" as const };
    const outcome = evaluateCorroborationGate(corroboratedPanel, llmMode, det(false));
    expect(outcome.mode).toBe("llm");
    expect(outcome.tripped).toBe(true); // tripped by the panel, not by det
    expect(outcome.corroboratedClusters).toHaveLength(1);
    expect(outcome.deterministic).toEqual(det(false));
  });

  it("is reproducible across repeated evaluation of identical input", () => {
    const runs = Array.from({ length: 5 }, () =>
      evaluateCorroborationGate(corroboratedPanel, DEFAULT_GATE, det(false)),
    );
    for (const r of runs) expect(r).toEqual(runs[0]);
  });

  it("disabled gate stays disabled regardless of the deterministic verdict", () => {
    const outcome = evaluateCorroborationGate(
      corroboratedPanel,
      { ...DEFAULT_GATE, groundingGateEnabled: false },
      det(false),
    );
    expect(outcome.tripped).toBe(false);
    expect(applyGate(9.5, outcome)).toBe(9.5);
  });
});
