import { describe, expect, it } from "vitest";
import {
  ALGOLIA_ANSWER_RUBRIC,
  DEFAULT_GATE,
  DEFAULT_SYNTHESIS,
  aggregateRounds,
  consensusScore,
  multiRoundStats,
  stdDev,
  synthesize,
} from "../src/index.js";
import { makeJudgment } from "./helpers.js";

/** One round's panel: skeptic+referee+advocate at flat scores, optional skeptic violation. */
function round(
  skeptic: number,
  referee: number,
  advocate: number,
  skepticViolation = false,
) {
  return [
    makeJudgment("skeptic", "skeptic", skeptic, skepticViolation ? [{ confidence: 0.9 }] : []),
    makeJudgment("referee", "referee", referee),
    makeJudgment("advocate", "advocate", advocate),
  ];
}

describe("consensusScore", () => {
  it("mean rule averages judges' scores on the 0-10 scale", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 4), // 4 on 1-10 -> 3.33 on 0-10
      makeJudgment("referee", "referee", 7),
      makeJudgment("advocate", "advocate", 10),
    ];
    const score = consensusScore(panel, ALGOLIA_ANSWER_RUBRIC, { rule: "mean" });
    // flat scores aggregate to the flat value, rescaled (v-1)/9*10
    const exp = ((4 - 1) / 9 + (7 - 1) / 9 + (10 - 1) / 9) / 3 * 10;
    expect(score).toBeCloseTo(exp, 5);
  });

  it("median rule is robust to a single generous outlier", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 5),
      makeJudgment("referee", "referee", 6),
      makeJudgment("advocate", "advocate", 10),
    ];
    const med = consensusScore(panel, ALGOLIA_ANSWER_RUBRIC, { rule: "median" });
    expect(med).toBeCloseTo(((6 - 1) / 9) * 10, 5); // median raw = 6
  });

  it("trimmed-skeptic-weighted leans toward the skeptic and trims the top advocate", () => {
    const conservative = consensusScore(
      [
        makeJudgment("skeptic", "skeptic", 4),
        makeJudgment("referee", "referee", 7),
        makeJudgment("advocate", "advocate", 10),
      ],
      ALGOLIA_ANSWER_RUBRIC,
      { rule: "trimmed-skeptic-weighted", skepticWeight: 1.5 },
    );
    const plainMean = consensusScore(
      [
        makeJudgment("skeptic", "skeptic", 4),
        makeJudgment("referee", "referee", 7),
        makeJudgment("advocate", "advocate", 10),
      ],
      ALGOLIA_ANSWER_RUBRIC,
      { rule: "mean" },
    );
    // Skeptic up-weighted + top advocate trimmed => below the plain mean.
    expect(conservative).toBeLessThan(plainMean);
  });
});

describe("synthesize (consensus -> hard gate reconciliation)", () => {
  it("returns the consensus score when the gate does not trip", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 8),
      makeJudgment("referee", "referee", 8),
      makeJudgment("advocate", "advocate", 8),
    ];
    const r = synthesize(panel, ALGOLIA_ANSWER_RUBRIC, DEFAULT_SYNTHESIS, DEFAULT_GATE);
    expect(r.gate.tripped).toBe(false);
    expect(r.finalScore).toBeCloseTo(r.preGateScore, 5);
    expect(r.finalScore).toBeCloseTo(((8 - 1) / 9) * 10, 5);
  });

  it("CAPS the final score when the skeptic flags a verified violation, despite high prose", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 9, [{ confidence: 0.95 }]),
      makeJudgment("referee", "referee", 9),
      makeJudgment("advocate", "advocate", 10),
    ];
    const r = synthesize(panel, ALGOLIA_ANSWER_RUBRIC, DEFAULT_SYNTHESIS, DEFAULT_GATE);
    expect(r.gate.tripped).toBe(true);
    expect(r.preGateScore).toBeGreaterThan(DEFAULT_GATE.cap); // prose was high
    expect(r.finalScore).toBe(DEFAULT_GATE.cap); // ...but capped
  });

  it("reports panel spread as a variance signal", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 3),
      makeJudgment("referee", "referee", 6),
      makeJudgment("advocate", "advocate", 9),
    ];
    const r = synthesize(panel, ALGOLIA_ANSWER_RUBRIC, DEFAULT_SYNTHESIS, DEFAULT_GATE);
    const expSpread = ((9 - 1) / 9) * 10 - ((3 - 1) / 9) * 10;
    expect(r.panelSpread).toBeCloseTo(expSpread, 5);
  });
});

describe("multi-round variance", () => {
  it("stdDev is zero for identical rounds and positive when they differ", () => {
    expect(stdDev([5, 5, 5])).toBe(0);
    expect(stdDev([4, 6])).toBeGreaterThan(0);
  });

  it("multiRoundStats summarises scores across rounds", () => {
    const stats = multiRoundStats([7, 7, 9], true);
    expect(stats.rounds).toBe(3);
    expect(stats.meanFinalScore).toBeCloseTo((7 + 7 + 9) / 3, 5);
    expect(stats.range).toBeCloseTo(2, 5);
    expect(stats.anyGateTripped).toBe(true);
  });
});

describe("aggregateRounds (voted gate over a stable mean pre-gate)", () => {
  const opts = { rubric: ALGOLIA_ANSWER_RUBRIC, synthesis: DEFAULT_SYNTHESIS, gate: DEFAULT_GATE };

  it("does NOT trip on a MINORITY of gate trips — the flicker bug fix", () => {
    // 1 of 3 rounds flagged a violation (stochastic skeptic mood); 2 were clean.
    const perRound = [round(7, 8, 8, true), round(7, 8, 8), round(7, 8, 8)];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);

    expect(agg.gateTripFraction).toBeCloseTo(1 / 3, 5);
    expect(agg.gateTripped).toBe(false);
    // Final tracks the stable mean pre-gate, NOT the cap.
    expect(agg.finalScore).toBeCloseTo(agg.meanPreGateScore, 5);
    expect(agg.finalScore).toBeGreaterThan(DEFAULT_GATE.cap);
  });

  it("DOES trip when violations reproduce in a MAJORITY of rounds", () => {
    // 2 of 3 rounds flagged a violation -> a real, reproducible grounding problem.
    const perRound = [round(7, 8, 8, true), round(7, 8, 8, true), round(7, 8, 8)];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);

    expect(agg.gateTripFraction).toBeCloseTo(2 / 3, 5);
    expect(agg.gateTripped).toBe(true);
    expect(agg.finalScore).toBe(DEFAULT_GATE.cap);
  });

  it("reports a stable mean and ZERO stdDev when rounds are identical", () => {
    const perRound = [round(8, 8, 8), round(8, 8, 8), round(8, 8, 8)];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);

    const single = consensusScore(round(8, 8, 8), opts.rubric, opts.synthesis);
    expect(agg.meanPreGateScore).toBeCloseTo(single, 5);
    expect(agg.stdDevPreGateScore).toBe(0);
    expect(agg.rounds).toBe(3);
    expect(agg.gateTripped).toBe(false);
  });

  it("surfaces pre-gate variance (positive stdDev) when judges drift across rounds", () => {
    const perRound = [round(6, 6, 6), round(8, 8, 8)];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.stdDevPreGateScore).toBeGreaterThan(0);
    expect(agg.perRoundPreGate).toHaveLength(2);
  });

  // --- supermajority + borderline (default policy) -------------------------
  function rounds5(violationCount: number) {
    return Array.from({ length: 5 }, (_, i) => round(7, 8, 8, i < violationCount));
  }

  it("by DEFAULT requires a supermajority (>=2/3) of rounds to trip the gate", () => {
    // 3 of 5 rounds = 0.6, below the default supermajority -> NOT tripped.
    const below = aggregateRounds(rounds5(3), opts.rubric, opts.synthesis, opts.gate);
    expect(below.gateTripped).toBe(false);
    // 4 of 5 = 0.8, a supermajority -> tripped.
    const above = aggregateRounds(rounds5(4), opts.rubric, opts.synthesis, opts.gate);
    expect(above.gateTripped).toBe(true);
    expect(above.finalScore).toBe(DEFAULT_GATE.cap);
  });

  it("FLAGS borderline (and does NOT cap) when violations appear but are not reproducible", () => {
    // 2 of 5 rounds flagged: some evidence, below supermajority, above 'clean'.
    const agg = aggregateRounds(rounds5(2), opts.rubric, opts.synthesis, opts.gate);
    expect(agg.gateTripped).toBe(false);
    expect(agg.borderline).toBe(true);
    // Not capped — final tracks the stable mean pre-gate.
    expect(agg.finalScore).toBeCloseTo(agg.meanPreGateScore, 5);
    expect(agg.finalScore).toBeGreaterThan(DEFAULT_GATE.cap);
  });

  it("is neither tripped nor borderline when rounds are reproducibly clean", () => {
    const agg = aggregateRounds(rounds5(0), opts.rubric, opts.synthesis, opts.gate);
    expect(agg.gateTripped).toBe(false);
    expect(agg.borderline).toBe(false);
  });

  it("is tripped (not merely borderline) when violations reproduce every round", () => {
    const agg = aggregateRounds(rounds5(5), opts.rubric, opts.synthesis, opts.gate);
    expect(agg.gateTripped).toBe(true);
    expect(agg.borderline).toBe(false);
  });
});

describe("aggregateRounds — claim-level gate (zero-flicker)", () => {
  const opts = { rubric: ALGOLIA_ANSWER_RUBRIC, synthesis: DEFAULT_SYNTHESIS, gate: DEFAULT_GATE };

  /** A round whose skeptic flags ONE specific claim at a given confidence. */
  function roundWithClaim(claim: string, confidence = 0.9) {
    const skeptic = makeJudgment("skeptic", "skeptic", 7, [{ confidence }]);
    return [
      { ...skeptic, groundingViolations: [{ claim, reason: "not in sources", certainty: confidence }] },
      makeJudgment("referee", "referee", 8),
      makeJudgment("advocate", "advocate", 8),
    ];
  }

  it("does NOT trip on heterogeneous one-off claims — no single claim recurs", () => {
    // Every round flags SOMETHING, but a different thing each time → skeptic noise,
    // not a reproducible violation. Old logic counted 3/3 trips and gated; wrong.
    const perRound = [
      roundWithClaim("vector search uses numeric embeddings"),
      roundWithClaim("facetFilters restrict to selected refinements"),
      roundWithClaim("NeuralSearch blends keyword and semantic ranking"),
    ];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.gateTripped).toBe(false);
  });

  it("DOES trip when the SAME claim recurs, even as confidence wobbles across the old cutoff", () => {
    // The anti-flicker guarantee: a real violation flagged every round trips
    // stably, regardless of confidence dipping below the old verified cutoff.
    const perRound = [
      roundWithClaim("the opening definition is ungrounded", 0.62),
      roundWithClaim("the opening definition is ungrounded", 0.78),
      roundWithClaim("the opening definition is ungrounded", 0.55),
    ];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.gateTripped).toBe(true);
    expect(agg.finalScore).toBe(DEFAULT_GATE.cap);
  });

  it("does NOT trip when a recurring claim is kind=unverifiable (thin-source, not fabrication)", () => {
    // Regression (2026-06-27): the multi-round claim-recurrence gate must apply the
    // same kind filter the single-round gate does (gate.ts drops `unverifiable`).
    // A plausible claim simply ABSENT from thin sources recurs every round but is
    // NOT a fabrication — it lowers the grounding dimension, it must not cap the
    // composite. Without the filter, every real answer whose claims aren't all in
    // the retrieved snippets was slammed to the cap (calibration Spearman ~0).
    const claim = "Under Armour saw a 15% increase in conversion rates";
    const mk = (conf: number) => [
      {
        ...makeJudgment("skeptic", "skeptic", 7),
        groundingViolations: [
          { claim, reason: "not in the provided sources", certainty: conf, kind: "unverifiable" as const },
        ],
      },
      makeJudgment("referee", "referee", 8),
      makeJudgment("advocate", "advocate", 8),
    ];
    const perRound = [mk(1.0), mk(0.9), mk(1.0)];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.gateTripped).toBe(false);
    expect(agg.finalScore).toBeGreaterThan(DEFAULT_GATE.cap);
  });

  it("DOES trip when a recurring claim is kind=contradicted (real fabrication)", () => {
    // The other side of the filter: an injected fabricated statistic recurs and
    // is correctly labeled `contradicted` → it MUST cap the composite.
    const claim = "Algolia guarantees a 42% conversion lift within 90 days";
    const mk = () => [
      {
        ...makeJudgment("skeptic", "skeptic", 7),
        groundingViolations: [
          { claim, reason: "no source supports this exact statistic", certainty: 1.0, kind: "contradicted" as const },
        ],
      },
      makeJudgment("referee", "referee", 8),
      makeJudgment("advocate", "advocate", 8),
    ];
    const perRound = [mk(), mk(), mk()];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.gateTripped).toBe(true);
    expect(agg.finalScore).toBe(DEFAULT_GATE.cap);
  });

  it("reports per-dimension means averaged across judges and rounds", () => {
    // skeptic=4, referee=7, advocate=10 on every dimension → mean 7 per dim.
    const perRound = [round(4, 7, 10), round(4, 7, 10)];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.dimensionMeans).toBeDefined();
    // the 4-dimension model: grounding / coverage / depth / relevance
    expect(agg.dimensionMeans.grounding).toBeCloseTo(7, 5);
    expect(agg.dimensionMeans.coverage).toBeCloseTo(7, 5);
    expect(agg.dimensionMeans.depth).toBeCloseTo(7, 5);
    expect(agg.dimensionMeans.relevance).toBeCloseTo(7, 5);
    // a dropped legacy dimension is absent from the means.
    expect(agg.dimensionMeans.engagement).toBeUndefined();
  });

  it("reports each judge's round-averaged composite (0-10), driving the mean final", () => {
    // flat scores → each judge's composite == its rescaled flat value.
    const perRound = [round(4, 7, 10), round(4, 7, 10)];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    const byId = new Map(agg.judgeComposites.map((c) => [c.judgeId, c]));
    expect(agg.judgeComposites).toHaveLength(3);
    expect(byId.get("skeptic")!.composite).toBeCloseTo(((4 - 1) / 9) * 10, 5);
    expect(byId.get("referee")!.composite).toBeCloseTo(((7 - 1) / 9) * 10, 5);
    expect(byId.get("advocate")!.composite).toBeCloseTo(((10 - 1) / 9) * 10, 5);
    expect(byId.get("advocate")!.temperament).toBe("advocate");
    // final pre-gate is the MEAN of the three composites (Arijit's rule).
    const meanOfComposites =
      agg.judgeComposites.reduce((s, c) => s + c.composite, 0) / 3;
    expect(agg.meanPreGateScore).toBeCloseTo(meanOfComposites, 5);
  });
});
