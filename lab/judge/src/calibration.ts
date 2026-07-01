/**
 * calibration — the VALIDITY GATE for the judge (spec §7, D10).
 *
 * Before any judge score is trusted to steer Phase 2 or ship to the UI as
 * authoritative, the judge must agree with a human's quality ranking of the same
 * answers. A human (Arijit) ranks ~12 representative answers by gut feel; we run
 * the 4-dimension judge over the SAME answers, rank the answers by their judge
 * composite, and compute the Spearman rank correlation between the two orderings.
 * The judge passes the gate iff the correlation clears an agreed bar (target >= 0.7).
 *
 * This module is PURE except for the injected `LlmComplete` — same seam as the
 * rest of the engine. `spearman` does no I/O at all.
 */
import { judgeArtifactMultiRound } from "./judge.js";
import type { Artifact, JudgeConfig, LlmComplete, Source } from "./types.js";

/**
 * Average ranks for a vector of values, ties resolved by AVERAGE rank (the
 * standard tie-correction for Spearman). Rank 1 is the SMALLEST value. Pure.
 *
 * Example: [10, 20, 20, 40] → [1, 2.5, 2.5, 4] (the two 20s share ranks 2 and 3,
 * averaged to 2.5 each).
 */
export function averageRanks(values: readonly number[]): number[] {
  // Index the values so we can scatter ranks back to original positions.
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    // Find the run of equal values [i, j).
    let j = i + 1;
    while (j < indexed.length && indexed[j].value === indexed[i].value) j++;
    // Positions i..j-1 (0-based) get 1-based ranks i+1..j; tie → their average.
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k].index] = avgRank;
    i = j;
  }
  return ranks;
}

/**
 * Spearman rank correlation between two equal-length numeric vectors. Returns a
 * value in [-1, 1]: 1 = identical ordering, -1 = exactly reversed, 0 = none.
 * Ties are handled via average ranks, so this is the general (Pearson-on-ranks)
 * form, valid in the presence of ties. Pure — no I/O.
 *
 * Throws if the vectors differ in length or are shorter than 2 (correlation is
 * undefined for fewer than two points).
 */
export function spearman(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `spearman: vectors must be equal length (got ${a.length} and ${b.length}).`,
    );
  }
  if (a.length < 2) {
    throw new Error("spearman: need at least 2 points to compute correlation.");
  }

  const ra = averageRanks(a);
  const rb = averageRanks(b);
  const n = ra.length;

  const meanA = ra.reduce((s, x) => s + x, 0) / n;
  const meanB = rb.reduce((s, x) => s + x, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  // Zero variance (all ranks identical) → correlation is undefined; report 0.
  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

/**
 * One answer to calibrate: a question, the answer text, the sources it was
 * allowed to ground in, and the HUMAN's blind rank (1 = best). `humanRank` is
 * `null` until the human fills the ranking sheet; items with a null rank are
 * skipped from the correlation.
 */
export interface CalibrationItem {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly sources: readonly Source[];
  /** Human's quality rank, 1 = best. `null` until ranked → skipped. */
  readonly humanRank: number | null;
  /** Optional Coverage checklist threaded into the judge artifact, if available. */
  readonly extractedEntities?: Artifact["extractedEntities"];
}

/** Per-item EVIDENCE for diagnosing a failing calibration (verbose mode). */
export interface CalibrationDiagnostics {
  /** Mean per-dimension scores across all judges + rounds. */
  readonly dimensionMeans: Record<string, number>;
  /** Pre-gate consensus (before any grounding cap). */
  readonly preGateScore: number;
  /** Did the grounding hard-gate trip (cap the composite)? */
  readonly gateTripped: boolean;
  /** The grounding violations the gating (skeptic) judge raised, deduped by claim+kind. */
  readonly groundingViolations: readonly {
    claim: string;
    kind: string;
    certainty: number;
  }[];
}

/** One item's calibration outcome: the human rank vs the judge's rank. */
export interface CalibrationPerItem {
  readonly id: string;
  readonly humanRank: number;
  readonly judgeComposite: number;
  /** Rank of this item's judge composite, 1 = best (highest composite). */
  readonly judgeRank: number;
  /** Present only when runCalibration is called with `verbose: true`. */
  readonly diagnostics?: CalibrationDiagnostics;
}

export interface CalibrationResult {
  readonly perItem: readonly CalibrationPerItem[];
  /** Spearman correlation between human ranks and judge ranks over ranked items. */
  readonly spearman: number;
  /** Number of items that contributed (had a non-null human rank). */
  readonly n: number;
}

/**
 * Runs the judge over every ranked calibration item and computes the Spearman
 * correlation between the human ranking and the judge's ranking.
 *
 * For each item: build an `Artifact` (the item's sources + optional entities),
 * score it via `judgeArtifactMultiRound`, and take the voted aggregate composite
 * (`aggregate.finalScore`) as the judge's quality number. Items are then ranked
 * by that composite (highest composite → rank 1, matching the human convention
 * that rank 1 is best), and correlated against the human ranks.
 *
 * Items with `humanRank === null` are NOT scored or counted (nothing to correlate
 * against). Pure except for the injected `llm`.
 */
export async function runCalibration(
  items: readonly CalibrationItem[],
  cfg: JudgeConfig,
  llm: LlmComplete,
  rounds = 1,
  verbose = false,
): Promise<CalibrationResult> {
  const ranked = items.filter((it) => it.humanRank !== null);
  if (ranked.length < 2) {
    throw new Error(
      `runCalibration: need at least 2 ranked items (got ${ranked.length}). ` +
        "Fill humanRank in the calibration set first.",
    );
  }

  // Score each ranked item with the full panel. Sequential to keep provider load
  // predictable; the per-item work is itself parallel across lenses.
  const scored: {
    id: string;
    humanRank: number;
    composite: number;
    diagnostics?: CalibrationDiagnostics;
  }[] = [];
  const gating = new Set(cfg.gate.gatingTemperaments);
  for (const item of ranked) {
    const artifact: Artifact = {
      type: "algolia-answer",
      prompt: item.question,
      content: item.answer,
      sources: item.sources,
      ...(item.extractedEntities ? { extractedEntities: item.extractedEntities } : {}),
    };
    const result = await judgeArtifactMultiRound(artifact, cfg, llm, rounds);
    let diagnostics: CalibrationDiagnostics | undefined;
    if (verbose) {
      // Dedup the gating judge's violations by claim+kind, keeping the max certainty —
      // the evidence for WHY (or why not) an item's grounding gate tripped.
      const byKey = new Map<string, { claim: string; kind: string; certainty: number }>();
      for (const pr of result.perRound) {
        for (const j of pr.judgments) {
          if (!gating.has(j.temperament)) continue;
          for (const v of j.groundingViolations) {
            const kind = v.kind ?? "contradicted";
            const key = `${kind}::${v.claim}`;
            const prev = byKey.get(key);
            if (!prev || v.certainty > prev.certainty) {
              byKey.set(key, { claim: v.claim, kind, certainty: v.certainty });
            }
          }
        }
      }
      diagnostics = {
        dimensionMeans: result.aggregate.dimensionMeans,
        preGateScore: result.aggregate.meanPreGateScore,
        gateTripped: result.aggregate.gateTripped,
        groundingViolations: [...byKey.values()],
      };
    }
    scored.push({
      id: item.id,
      // ranked items have a non-null humanRank by construction (filtered above).
      humanRank: item.humanRank as number,
      composite: result.aggregate.finalScore,
      ...(diagnostics ? { diagnostics } : {}),
    });
  }

  // Judge rank: best (highest composite) → rank 1. averageRanks ranks SMALLEST as
  // 1, so rank the NEGATED composite to flip the order, with tie-averaging intact.
  const judgeRanks = averageRanks(scored.map((s) => -s.composite));

  const perItem: CalibrationPerItem[] = scored.map((s, i) => ({
    id: s.id,
    humanRank: s.humanRank,
    judgeComposite: s.composite,
    judgeRank: judgeRanks[i],
    ...(s.diagnostics ? { diagnostics: s.diagnostics } : {}),
  }));

  const rho = spearman(
    perItem.map((p) => p.humanRank),
    perItem.map((p) => p.judgeRank),
  );

  return { perItem, spearman: rho, n: perItem.length };
}
