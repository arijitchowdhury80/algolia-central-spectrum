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

/**
 * One round's panel: skeptic+referee+advocate at flat scores.
 * `violationMode`:
 *   - false / "none": no violations.
 *   - "solo": ONLY the skeptic flags a violation (claim "claim 0" — makeJudgment
 *     resets its per-call claim index, so two judges given a violation both
 *     produce the identical claim text "claim 0", i.e. claimSimilarity 1.0).
 *   - "corroborated": BOTH skeptic and referee flag the identical claim text
 *     ("claim 0") — 2 distinct judges, the Phase 2 corroboration threshold.
 */
function round(
  skeptic: number,
  referee: number,
  advocate: number,
  violationMode: false | "none" | "solo" | "corroborated" = false,
) {
  const solo = violationMode === "solo";
  const corroborated = violationMode === "corroborated";
  return [
    makeJudgment("skeptic", "skeptic", skeptic, solo || corroborated ? [{ confidence: 0.9 }] : []),
    makeJudgment("referee", "referee", referee, corroborated ? [{ confidence: 0.9 }] : []),
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

  it("does NOT cap on a SOLO skeptic violation — the 9/9/9->3.10 bug fix", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 9, [{ confidence: 0.95 }]),
      makeJudgment("referee", "referee", 9),
      makeJudgment("advocate", "advocate", 10),
    ];
    const r = synthesize(panel, ALGOLIA_ANSWER_RUBRIC, DEFAULT_SYNTHESIS, DEFAULT_GATE);
    expect(r.gate.tripped).toBe(false);
    expect(r.gate.borderline).toBe(true);
    expect(r.finalScore).toBeCloseTo(r.preGateScore, 5); // NOT capped
  });

  it("CAPS the final score when 2 distinct judges corroborate the same violation, despite high prose", () => {
    const panel = [
      makeJudgment("skeptic", "skeptic", 9, [{ confidence: 0.95 }]),
      makeJudgment("referee", "referee", 9, [{ confidence: 0.9 }]), // identical claim text ("claim 0")
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

describe("aggregateRounds (Phase 2: cross-judge corroboration, round-invariant)", () => {
  const opts = { rubric: ALGOLIA_ANSWER_RUBRIC, synthesis: DEFAULT_SYNTHESIS, gate: DEFAULT_GATE };

  it("does NOT trip when the SAME judge (skeptic) flags a solo violation in every round", () => {
    // Temp-0 judges are deterministic — the same judge repeating a solo flag
    // across rounds is still ONE distinct judgeId. The old per-round-vote gate
    // would have tripped this (3/3 rounds); the new cross-judge gate must not.
    const perRound = [round(7, 8, 8, "solo"), round(7, 8, 8, "solo"), round(7, 8, 8, "solo")];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);

    expect(agg.gateTripped).toBe(false);
    expect(agg.borderline).toBe(true);
    expect(agg.gateTripFraction).toBe(0);
    // Final tracks the stable mean pre-gate, NOT the cap.
    expect(agg.finalScore).toBeCloseTo(agg.meanPreGateScore, 5);
    expect(agg.finalScore).toBeGreaterThan(DEFAULT_GATE.cap);
  });

  it("DOES trip when 2 distinct judges corroborate the same claim, even in a SINGLE round", () => {
    const perRound = [round(7, 8, 8, "corroborated")];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);

    expect(agg.gateTripped).toBe(true);
    expect(agg.gateTripFraction).toBe(1);
    expect(agg.finalScore).toBe(DEFAULT_GATE.cap);
  });

  it("is ROUND-INVARIANT: 1 round and 3 rounds of the SAME judges give the SAME gate decision", () => {
    const single = aggregateRounds(
      [round(7, 8, 8, "corroborated")],
      opts.rubric,
      opts.synthesis,
      opts.gate,
      0.5,
    );
    const triple = aggregateRounds(
      [round(7, 8, 8, "corroborated"), round(7, 8, 8, "corroborated"), round(7, 8, 8, "corroborated")],
      opts.rubric,
      opts.synthesis,
      opts.gate,
      0.5,
    );
    expect(triple.gateTripped).toBe(single.gateTripped);
    expect(triple.gateTripped).toBe(true);

    const singleSolo = aggregateRounds(
      [round(7, 8, 8, "solo")],
      opts.rubric,
      opts.synthesis,
      opts.gate,
      0.5,
    );
    const tripleSolo = aggregateRounds(
      [round(7, 8, 8, "solo"), round(7, 8, 8, "solo"), round(7, 8, 8, "solo")],
      opts.rubric,
      opts.synthesis,
      opts.gate,
      0.5,
    );
    expect(tripleSolo.gateTripped).toBe(singleSolo.gateTripped);
    expect(tripleSolo.gateTripped).toBe(false);
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

  it("is neither tripped nor borderline when rounds are reproducibly clean", () => {
    const perRound = [round(7, 8, 8), round(7, 8, 8), round(7, 8, 8)];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.gateTripped).toBe(false);
    expect(agg.borderline).toBe(false);
  });

  it("exposes corroboratedClusters/soloFlags from the pooled gate outcome", () => {
    const solo = aggregateRounds(
      [round(7, 8, 8, "solo")],
      opts.rubric,
      opts.synthesis,
      opts.gate,
      0.5,
    );
    expect(solo.soloFlags).toHaveLength(1);
    expect(solo.corroboratedClusters).toHaveLength(0);

    const corroborated = aggregateRounds(
      [round(7, 8, 8, "corroborated")],
      opts.rubric,
      opts.synthesis,
      opts.gate,
      0.5,
    );
    expect(corroborated.corroboratedClusters).toHaveLength(1);
    expect(corroborated.soloFlags).toHaveLength(0);
  });
});

describe("aggregateRounds — kind filter (unchanged from Phase 1)", () => {
  const opts = { rubric: ALGOLIA_ANSWER_RUBRIC, synthesis: DEFAULT_SYNTHESIS, gate: DEFAULT_GATE };

  it("does NOT trip on a corroborated kind=unverifiable claim in LEGACY mode", () => {
    // Legacy behaviour, retained under an explicit flag: while sources were
    // truncated to 3,500 chars, "absent" mostly meant "cut off", so absence had
    // to be non-gating. Default flipped 2026-07-28 once sources became complete —
    // see the sibling test below.
    const claim = "Under Armour saw a 15% increase in conversion rates";
    const mk = (conf: number) => [
      {
        ...makeJudgment("skeptic", "skeptic", 7),
        groundingViolations: [
          { claim, reason: "not in the provided sources", certainty: conf, kind: "unverifiable" as const },
        ],
      },
      {
        ...makeJudgment("referee", "referee", 8),
        groundingViolations: [
          { claim, reason: "not in the provided sources", certainty: conf, kind: "unverifiable" as const },
        ],
      },
      makeJudgment("advocate", "advocate", 8),
    ];
    const perRound = [mk(1.0), mk(0.9), mk(1.0)];
    const legacyGate = { ...DEFAULT_GATE, gateOnUnverifiable: false };
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, legacyGate, 0.5);
    expect(agg.gateTripped).toBe(false);
    expect(agg.finalScore).toBeGreaterThan(DEFAULT_GATE.cap);
  });

  it("DOES trip on a corroborated kind=unverifiable claim under the DEFAULT gate", () => {
    // The product requirement is that nothing outside the corpus reaches the
    // user. Hallucination usually invents rather than contradicts, so absence
    // must be gate-eligible for the gate to enforce what it claims to.
    const claim = "Under Armour saw a 15% increase in conversion rates";
    const mk = (conf: number) => [
      {
        ...makeJudgment("skeptic", "skeptic", 7),
        groundingViolations: [
          { claim, reason: "not in the provided sources", certainty: conf, kind: "unverifiable" as const },
        ],
      },
      {
        ...makeJudgment("referee", "referee", 8),
        groundingViolations: [
          { claim, reason: "not in the provided sources", certainty: conf, kind: "unverifiable" as const },
        ],
      },
      makeJudgment("advocate", "advocate", 8),
    ];
    const agg = aggregateRounds([mk(1.0), mk(0.9), mk(1.0)], opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.gateTripped).toBe(true);
    expect(agg.finalScore).toBeLessThanOrEqual(DEFAULT_GATE.cap);
  });

  it("DOES trip when 2 judges corroborate a kind=contradicted claim (real fabrication)", () => {
    const claim = "Algolia guarantees a 42% conversion lift within 90 days";
    const mk = () => [
      {
        ...makeJudgment("skeptic", "skeptic", 7),
        groundingViolations: [
          { claim, reason: "no source supports this exact statistic", certainty: 1.0, kind: "contradicted" as const },
        ],
      },
      {
        ...makeJudgment("referee", "referee", 8),
        groundingViolations: [
          { claim, reason: "no source supports this exact statistic", certainty: 1.0, kind: "contradicted" as const },
        ],
      },
      makeJudgment("advocate", "advocate", 8),
    ];
    const perRound = [mk(), mk(), mk()];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.gateTripped).toBe(true);
    expect(agg.finalScore).toBe(DEFAULT_GATE.cap);
  });

  it("reports per-dimension means averaged across judges and rounds (single usefulness dimension)", () => {
    // skeptic=4, referee=7, advocate=10 -> mean 7 for the one usefulness dimension.
    const perRound = [round(4, 7, 10), round(4, 7, 10)];
    const agg = aggregateRounds(perRound, opts.rubric, opts.synthesis, opts.gate, 0.5);
    expect(agg.dimensionMeans).toBeDefined();
    expect(agg.dimensionMeans.usefulness).toBeCloseTo(7, 5);
    // the dropped 4-dimension model is absent from the means.
    expect(agg.dimensionMeans.grounding).toBeUndefined();
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
    // final pre-gate is the MEAN of the three composites (per the scoring rule).
    const meanOfComposites =
      agg.judgeComposites.reduce((s, c) => s + c.composite, 0) / 3;
    expect(agg.meanPreGateScore).toBeCloseTo(meanOfComposites, 5);
  });
});
