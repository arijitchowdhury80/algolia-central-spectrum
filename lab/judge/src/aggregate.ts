import { applicableDimensions } from "./rubric.js";
import type {
  Artifact,
  DimensionScore,
  Rubric,
} from "./types.js";

/**
 * Weighted aggregation of one judge's dimension scores into a single value on
 * the rubric's [min,max] scale.
 *
 * - Only APPLICABLE dimensions count (optional ones marked N/A are dropped).
 * - A dimension the judge failed to score is treated as the rubric minimum
 *   (a missing score is not free).
 * - The result is the weighted mean of the scores, which preserves the [min,max]
 *   scale (weights bias the mean toward heavier dimensions but never push the
 *   value outside the score range).
 *
 * Pure: no I/O, deterministic.
 */
export function weightedAggregate(
  dimensionScores: readonly DimensionScore[],
  rubric: Rubric,
  artifact?: Pick<Artifact, "notApplicableDimensions">,
): number {
  const dims = applicableDimensions(rubric, artifact?.notApplicableDimensions);
  if (dims.length === 0) return rubric.min;

  const byId = new Map(dimensionScores.map((d) => [d.dimensionId, d.score]));

  let weightedSum = 0;
  let weightTotal = 0;
  for (const dim of dims) {
    const score = byId.get(dim.id) ?? rubric.min;
    weightedSum += score * dim.weight;
    weightTotal += dim.weight;
  }
  if (weightTotal === 0) return rubric.min;
  return weightedSum / weightTotal;
}

/**
 * Rescales a value from the rubric's [min,max] onto a 0-10 final scale. The
 * final synthesized score and the gate cap both live on 0-10 regardless of the
 * rubric's native range, so a custom rubric (e.g. 0-5) still produces a
 * comparable 0-10 number.
 *
 * Pure.
 */
export function toFinalScale(value: number, rubric: Rubric): number {
  const span = rubric.max - rubric.min;
  if (span <= 0) return value;
  const normalised = (value - rubric.min) / span; // 0..1
  return normalised * 10;
}
