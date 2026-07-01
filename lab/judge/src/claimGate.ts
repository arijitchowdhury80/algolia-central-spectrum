import type { GroundingViolation } from "./types.js";

/**
 * claimGate — claim-level multi-round grounding gate.
 *
 * Replaces the flicker-prone per-round confidence vote. The old gate tripped a
 * round whenever ANY verified violation fired, then took a supermajority over
 * rounds — so (a) heterogeneous one-off flags (a different imagined claim each
 * round) could gate, and (b) a borderline claim whose confidence wobbled around
 * the verified-confidence cutoff flipped the round trip on/off, landing the
 * fraction near the threshold and flipping run-to-run.
 *
 * This module decides the gate by CLAIM RECURRENCE: cluster the violations
 * across rounds by claim similarity, and trip only when the SAME claim is
 * flagged in a supermajority of rounds. A claim that appears once is treated as
 * noise; a real ungrounded claim recurs and gates stably regardless of
 * per-round confidence wobble. Pure: no I/O, deterministic.
 */

/** Tokens dropped before comparing claims — function words carry no claim identity. */
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "for", "and", "or", "but", "with", "as", "by",
  "that", "this", "it", "its", "at", "from", "into", "during", "via",
  "you", "your", "i", "we", "they", "he", "she", "do", "does", "can",
]);

/**
 * Light suffix stemmer so inflection variants of one word collapse:
 * compares/comparing/compared → compar, sources/source → sourc, retrieves → retriev.
 * Deliberately crude (not full Porter) — it only groups claim tokens for overlap,
 * never affects meaning. Guards a 3-char minimum stem so short words survive.
 */
function stem(token: string): string {
  let t = token;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ["ing", "ed", "es", "s"]) {
      if (t.endsWith(suffix) && t.length - suffix.length >= 3) {
        t = t.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  // Normalize a bare trailing "e" so base/inflected forms converge
  // (retrieve vs retrieves→retriev, store vs stores→stor). Keeps a 3-char stem.
  if (t.endsWith("e") && t.length > 3) t = t.slice(0, -1);
  return t;
}

/** Lowercase, strip punctuation, drop stopwords, stem → the set of meaningful tokens. */
function meaningfulTokens(claim: string): Set<string> {
  return new Set(
    claim
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t))
      .map(stem),
  );
}

/**
 * Similarity of two claims, 0–1, as the Jaccard overlap of their meaningful
 * token sets. 1.0 = identical token content; 0 = no shared meaningful token.
 */
export function claimSimilarity(a: string, b: string): number {
  const ta = meaningfulTokens(a);
  const tb = meaningfulTokens(b);
  if (ta.size === 0 && tb.size === 0) return 1.0;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Options governing how violations are clustered across rounds. */
export interface ClusterOptions {
  /** Min claimSimilarity for two claims to be the "same" cluster (0–1). */
  readonly simThreshold: number;
  /** Flags below this confidence are dropped before clustering (noise floor). */
  readonly minConfidence: number;
}

/** A claim flagged across one or more rounds, with how widely it recurred. */
export interface ClaimCluster {
  /** A representative claim string (the first flag that seeded the cluster). */
  readonly representativeClaim: string;
  /** Number of DISTINCT rounds in which this claim was flagged. */
  readonly roundsFlagged: number;
  /** roundsFlagged / total rounds — the recurrence signal the gate decides on. */
  readonly recurrenceFraction: number;
  /** Highest confidence any judge assigned this claim across all rounds. */
  readonly maxConfidence: number;
}

interface MutableCluster {
  representativeClaim: string;
  rounds: Set<number>;
  maxConfidence: number;
}

/**
 * Cluster grounding violations across rounds by claim similarity and count how
 * many DISTINCT rounds flagged each claim. Flags below `minConfidence` are
 * dropped first. Multiple flags of the same claim within one round count that
 * round once (recurrence is across rounds, not within). Pure.
 */
export function clusterRoundViolations(
  perRoundViolations: readonly (readonly GroundingViolation[])[],
  opts: ClusterOptions,
): ClaimCluster[] {
  const totalRounds = perRoundViolations.length;
  const clusters: MutableCluster[] = [];

  perRoundViolations.forEach((violations, roundIdx) => {
    for (const v of violations) {
      if (v.certainty < opts.minConfidence) continue;
      // Attach to the most similar existing cluster above threshold, else seed a new one.
      let best: MutableCluster | undefined;
      let bestSim = opts.simThreshold;
      for (const c of clusters) {
        const sim = claimSimilarity(v.claim, c.representativeClaim);
        if (sim >= bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (best) {
        best.rounds.add(roundIdx);
        best.maxConfidence = Math.max(best.maxConfidence, v.certainty);
      } else {
        clusters.push({
          representativeClaim: v.claim,
          rounds: new Set([roundIdx]),
          maxConfidence: v.certainty,
        });
      }
    }
  });

  return clusters.map((c) => ({
    representativeClaim: c.representativeClaim,
    roundsFlagged: c.rounds.size,
    recurrenceFraction: totalRounds === 0 ? 0 : c.rounds.size / totalRounds,
    maxConfidence: c.maxConfidence,
  }));
}

/** Config for the claim-recurrence gate. */
export interface ClaimGateConfig extends ClusterOptions {
  /**
   * Fraction of rounds a single claim must recur in to trip the gate (0–1).
   * Supermajority by default — one or two stray rounds never gate.
   */
  readonly recurrenceThreshold: number;
}

/**
 * Defaults tuned to kill flicker while still catching real violations:
 * - simThreshold 0.5  — paraphrases of one claim merge; distinct claims don't.
 * - minConfidence 0.3 — drop near-zero-confidence noise, but keep wobbling flags
 *   (the decision is recurrence, NOT a sharp confidence cutoff — that was the bug).
 * - recurrenceThreshold 0.6 — a claim must appear in a clear majority of rounds.
 */
export const DEFAULT_CLAIM_GATE: ClaimGateConfig = {
  simThreshold: 0.5,
  minConfidence: 0.3,
  recurrenceThreshold: 0.6,
};

/** Outcome of the claim-recurrence gate over a set of rounds. */
export interface ClaimGateOutcome {
  readonly tripped: boolean;
  /** The claim cluster that tripped the gate (the most-recurring one), if any. */
  readonly decidingCluster?: ClaimCluster;
  /** All clusters, for diagnostics/explanation. */
  readonly clusters: readonly ClaimCluster[];
}

/**
 * Decide the grounding gate across rounds by claim recurrence: trip iff some
 * single claim recurred in at least `recurrenceThreshold` of the rounds. Pure.
 *
 * This is the anti-flicker core: a real ungrounded claim recurs (and gates
 * stably even as its per-round confidence wobbles), while one-off imagined
 * flags never reach the recurrence bar and are treated as noise.
 */
export function evaluateClaimGate(
  perRoundViolations: readonly (readonly GroundingViolation[])[],
  cfg: ClaimGateConfig,
): ClaimGateOutcome {
  const clusters = clusterRoundViolations(perRoundViolations, cfg);
  let deciding: ClaimCluster | undefined;
  for (const c of clusters) {
    if (
      c.recurrenceFraction >= cfg.recurrenceThreshold &&
      (!deciding || c.recurrenceFraction > deciding.recurrenceFraction)
    ) {
      deciding = c;
    }
  }
  return {
    tripped: deciding !== undefined,
    ...(deciding ? { decidingCluster: deciding } : {}),
    clusters,
  };
}
