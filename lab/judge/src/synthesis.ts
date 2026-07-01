import { applyGate, evaluateHardGate } from "./gate.js";
import { evaluateClaimGate, DEFAULT_CLAIM_GATE } from "./claimGate.js";
import { toFinalScale } from "./aggregate.js";
import type {
  HardGateConfig,
  Judgment,
  MultiRoundStats,
  RoundAggregate,
  Rubric,
  SynthesisConfig,
  SynthesisResult,
} from "./types.js";

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Reconciles the panel's per-judge weighted scores into ONE pre-gate consensus
 * score on the 0-10 scale, per the configured consensus rule.
 *
 * Rules:
 * - "mean":   simple average of judges' weighted scores.
 * - "median": robust to a single outlier judge.
 * - "trimmed-skeptic-weighted": weighted mean where the Skeptic's score is
 *   multiplied by `skepticWeight` (false confidence is costlier than caution),
 *   after dropping the single highest non-Skeptic score if the panel has 3+
 *   judges (trims the most generous outlier).
 *
 * Inputs are judges' weighted scores already on the rubric scale; this function
 * rescales the consensus to 0-10. Pure.
 */
export function consensusScore(
  judgments: readonly Judgment[],
  rubric: Rubric,
  cfg: SynthesisConfig,
): number {
  const onFinal = judgments.map((j) => ({
    temperament: j.temperament,
    score: toFinalScale(j.weightedScore, rubric),
  }));

  switch (cfg.rule) {
    case "mean":
      return mean(onFinal.map((x) => x.score));

    case "median":
      return median(onFinal.map((x) => x.score));

    case "trimmed-skeptic-weighted": {
      const skepticWeight = cfg.skepticWeight ?? 1.5;
      const nonSkeptic = onFinal.filter((x) => x.temperament !== "skeptic");
      const skeptics = onFinal.filter((x) => x.temperament === "skeptic");

      // Trim the single most generous non-skeptic when the panel is large enough.
      let trimmedNonSkeptic = nonSkeptic;
      if (onFinal.length >= 3 && nonSkeptic.length >= 2) {
        const maxScore = Math.max(...nonSkeptic.map((x) => x.score));
        const idx = nonSkeptic.findIndex((x) => x.score === maxScore);
        trimmedNonSkeptic = nonSkeptic.filter((_, i) => i !== idx);
      }

      let weightedSum = 0;
      let weightTotal = 0;
      for (const x of skeptics) {
        weightedSum += x.score * skepticWeight;
        weightTotal += skepticWeight;
      }
      for (const x of trimmedNonSkeptic) {
        weightedSum += x.score;
        weightTotal += 1;
      }
      return weightTotal === 0 ? 0 : weightedSum / weightTotal;
    }
  }
}

/**
 * Population standard deviation. Pure. Near-zero variance (within float epsilon)
 * is snapped to exactly 0 so that identical rounds report perfect stability
 * rather than floating-point dust.
 */
export function stdDev(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  const variance = mean(xs.map((x) => (x - m) ** 2));
  if (variance < 1e-12) return 0;
  return Math.sqrt(variance);
}

/**
 * Produces the full SynthesisResult for one round: consensus -> hard gate ->
 * final score, plus panel spread (a variance signal) and a rationale.
 *
 * `rationale` is supplied by the caller (LLM-authored) or defaults to the gate
 * explanation. This function is PURE — it does not call any LLM.
 */
export function synthesize(
  judgments: readonly Judgment[],
  rubric: Rubric,
  synthesisCfg: SynthesisConfig,
  gateCfg: HardGateConfig,
  rationale?: string,
): SynthesisResult {
  const preGateScore = consensusScore(judgments, rubric, synthesisCfg);
  const gate = evaluateHardGate(judgments, gateCfg);
  const finalScore = applyGate(preGateScore, gate);

  const finalScores = judgments.map((j) => toFinalScale(j.weightedScore, rubric));
  const panelSpread =
    finalScores.length === 0 ? 0 : Math.max(...finalScores) - Math.min(...finalScores);

  return {
    finalScore,
    preGateScore,
    gate,
    panelSpread,
    rationale: rationale ?? gate.explanation,
  };
}

/**
 * Supermajority: a verified violation must reproduce in >= 2/3 of rounds to cap
 * the score. Below this but above the clean threshold = "borderline" (flagged,
 * not capped). Chosen because a real violation reproduces reliably (e.g. a
 * training-data leak flags every round) while an ambiguous skeptic flag does not.
 */
export const DEFAULT_GATE_VOTE_THRESHOLD = 2 / 3;
/** At or below this trip fraction the answer is treated as reproducibly clean. */
export const DEFAULT_GATE_CLEAN_THRESHOLD = 1 / 3;

/**
 * Reconciles N independent rounds into ONE stable verdict.
 *
 * The fix for judge instability: the per-judge PRE-gate consensus is averaged
 * (stable across rounds), while the hard gate is decided by a VOTE — a violation
 * must reproduce in `>= tripThreshold` of rounds to cap the score. Evidence
 * between the clean and trip thresholds is ambiguous and flagged `borderline`
 * rather than capped (we never cap on a coin flip). A single stochastic skeptic
 * flag therefore can no longer swing the final score.
 *
 * Pure: no LLM, no I/O.
 */
export function aggregateRounds(
  perRoundJudgments: readonly (readonly Judgment[])[],
  rubric: Rubric,
  synthesisCfg: SynthesisConfig,
  gateCfg: HardGateConfig,
  tripThreshold: number = DEFAULT_GATE_VOTE_THRESHOLD,
  cleanThreshold: number = DEFAULT_GATE_CLEAN_THRESHOLD,
): RoundAggregate {
  const rounds = perRoundJudgments.length;
  const perRoundPreGate = perRoundJudgments.map((js) =>
    consensusScore(js, rubric, synthesisCfg),
  );

  // CLAIM-LEVEL GATE (zero-flicker): instead of counting heterogeneous per-round
  // trips (which let a different imagined claim each round gate, and let a real
  // claim escape when its confidence dipped under a sharp cutoff), gather the
  // gating judges' violations per round and trip only when the SAME claim
  // RECURS in `tripThreshold` of rounds. Stable under confidence wobble.
  const gating = new Set(gateCfg.gatingTemperaments);
  const perRoundViolations = perRoundJudgments.map((js) =>
    js
      .filter((j) => gating.has(j.temperament))
      .flatMap((j) => j.groundingViolations)
      // Only CONTRADICTED/fabricated claims may cap the score. "unverifiable"
      // claims (plausible but absent from thin/partial sources) lower the
      // grounding DIMENSION but MUST NOT trip the hard gate — otherwise a real
      // answer whose claims aren't all in the retrieved snippets is slammed to
      // the cap. This mirrors the single-round gate (gate.ts verifiedGatingViolations,
      // which already drops `unverifiable`); the multi-round claim-recurrence path
      // was missing the same filter (spec §4.1 / D6).
      .filter((v) => v.kind !== "unverifiable"),
  );
  const claimGate = evaluateClaimGate(perRoundViolations, {
    ...DEFAULT_CLAIM_GATE,
    recurrenceThreshold: tripThreshold,
  });
  // The recurrence of the most-reproducible claim — the gate's evidence strength.
  const maxRecurrence = claimGate.clusters.reduce(
    (m, c) => Math.max(m, c.recurrenceFraction),
    0,
  );

  // Per-dimension means across ALL judges and ALL rounds (for loop diagnosis).
  const dimSums: Record<string, { sum: number; n: number }> = {};
  for (const js of perRoundJudgments) {
    for (const j of js) {
      for (const d of j.dimensionScores) {
        const cur = dimSums[d.dimensionId] ?? { sum: 0, n: 0 };
        cur.sum += d.score;
        cur.n += 1;
        dimSums[d.dimensionId] = cur;
      }
    }
  }
  const dimensionMeans: Record<string, number> = {};
  for (const [dim, { sum, n }] of Object.entries(dimSums)) {
    if (n > 0) dimensionMeans[dim] = sum / n;
  }

  // Per-judge composite (weightedScore → 0-10), averaged across rounds. The
  // final pre-gate score is the mean of these; the UI shows them individually.
  const compSums = new Map<
    string,
    { temperament: Judgment["temperament"]; total: number; n: number }
  >();
  for (const js of perRoundJudgments) {
    for (const j of js) {
      const cur =
        compSums.get(j.judgeId) ?? { temperament: j.temperament, total: 0, n: 0 };
      cur.total += toFinalScale(j.weightedScore, rubric);
      cur.n += 1;
      compSums.set(j.judgeId, cur);
    }
  }
  const judgeComposites = [...compSums.entries()].map(
    ([judgeId, { temperament, total, n }]) => ({
      judgeId,
      temperament,
      composite: n === 0 ? 0 : total / n,
    }),
  );

  const meanPreGateScore = mean(perRoundPreGate);
  const gateTripFraction = rounds === 0 ? 0 : maxRecurrence;
  const gateTripped = rounds > 0 && claimGate.tripped;
  const borderline = !gateTripped && gateTripFraction > cleanThreshold;
  const finalScore = gateTripped
    ? Math.min(meanPreGateScore, gateCfg.cap)
    : meanPreGateScore;

  return {
    rounds,
    perRoundPreGate,
    meanPreGateScore,
    stdDevPreGateScore: stdDev(perRoundPreGate),
    gateTripFraction,
    gateTripped,
    borderline,
    finalScore,
    dimensionMeans,
    judgeComposites,
  };
}

/** Aggregates per-round final scores into multi-round variance stats. Pure. */
export function multiRoundStats(
  finalScores: readonly number[],
  anyGateTripped: boolean,
): MultiRoundStats {
  return {
    rounds: finalScores.length,
    finalScores: [...finalScores],
    meanFinalScore: mean(finalScores),
    stdDevFinalScore: stdDev(finalScores),
    range:
      finalScores.length === 0
        ? 0
        : Math.max(...finalScores) - Math.min(...finalScores),
    anyGateTripped,
  };
}
