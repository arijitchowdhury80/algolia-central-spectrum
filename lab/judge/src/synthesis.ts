import { applyGate, evaluateCorroborationGate } from "./gate.js";
import { toFinalScale } from "./aggregate.js";
import type { DeterministicGrounding } from "./detGround.js";
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
 * explanation. `det` is the deterministic grounding verdict — required for the
 * gate to run in "deterministic" mode (see HardGateConfig.groundingMode); its
 * absence falls back to the LLM gate. This function is PURE — it does not call
 * any LLM.
 */
export function synthesize(
  judgments: readonly Judgment[],
  rubric: Rubric,
  synthesisCfg: SynthesisConfig,
  gateCfg: HardGateConfig,
  rationale?: string,
  det?: DeterministicGrounding,
): SynthesisResult {
  const preGateScore = consensusScore(judgments, rubric, synthesisCfg);
  const gate = evaluateCorroborationGate(judgments, gateCfg, det);
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
 * @deprecated Phase 1 per-round-vote thresholds. The Phase 2 corroboration
 * gate decides cross-JUDGE (not cross-round), so these no longer govern the
 * gate decision. Kept only as the default value for `aggregateRounds`'
 * now-unused parameters (back-compat signature).
 */
export const DEFAULT_GATE_VOTE_THRESHOLD = 2 / 3;
/** @deprecated see DEFAULT_GATE_VOTE_THRESHOLD. */
export const DEFAULT_GATE_CLEAN_THRESHOLD = 1 / 3;

/**
 * Reconciles N independent rounds into ONE stable verdict.
 *
 * Phase 2: the gate decision is now CROSS-JUDGE, not cross-round, and round-invariant at
 * temperature 0 (re-running the SAME judge adds no information). All rounds'
 * judgments are pooled and `evaluateCorroborationGate` runs on the union — a
 * claim corroborated by >= corroborationThreshold distinct judges in ANY
 * round trips; distinctness is by judgeId, so the same judge flagging the
 * same claim across rounds still counts once.
 *
 * `meanPreGateScore` stays the mean of per-round pre-gate consensus (the
 * stable quality metric); `finalScore` caps that mean iff the pooled gate
 * tripped. Pure: no LLM, no I/O.
 */
export function aggregateRounds(
  perRoundJudgments: readonly (readonly Judgment[])[],
  rubric: Rubric,
  synthesisCfg: SynthesisConfig,
  gateCfg: HardGateConfig,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- back-compat signature, see @deprecated above
  _tripThreshold: number = DEFAULT_GATE_VOTE_THRESHOLD,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- back-compat signature, see @deprecated above
  _cleanThreshold: number = DEFAULT_GATE_CLEAN_THRESHOLD,
  det?: DeterministicGrounding,
): RoundAggregate {
  const rounds = perRoundJudgments.length;
  const perRoundPreGate = perRoundJudgments.map((js) =>
    consensusScore(js, rubric, synthesisCfg),
  );

  // Pool ALL rounds' judgments and run the grounding gate on the union. `det`
  // is round-invariant by construction (a pure function of answer + sources),
  // so there is nothing to pool on the deterministic side — which is exactly
  // why the deterministic verdict cannot flicker across rounds.
  const pooledJudgments = perRoundJudgments.flat();
  const gateOutcome = evaluateCorroborationGate(pooledJudgments, gateCfg, det);

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
  const gateTripped = rounds > 0 && gateOutcome.tripped;
  const borderline = rounds > 0 && gateOutcome.borderline;
  // Deprecated field (see @deprecated on DEFAULT_GATE_VOTE_THRESHOLD): the
  // cross-judge gate is binary, not a per-round fraction. Kept for wire
  // back-compat until Phase 6 removes it.
  const gateTripFraction = gateTripped ? 1 : 0;
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
    corroboratedClusters: gateOutcome.corroboratedClusters,
    soloFlags: gateOutcome.soloFlags,
    advisoryClusters: gateOutcome.advisoryClusters ?? [],
    gateMode: gateOutcome.mode,
    ...(gateOutcome.deterministic ? { deterministic: gateOutcome.deterministic } : {}),
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
