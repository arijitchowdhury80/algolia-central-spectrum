import { describe, expect, test } from "vitest";
import {
  claimSimilarity,
  clusterRoundViolations,
  evaluateClaimGate,
  DEFAULT_CLAIM_GATE,
} from "../src/claimGate.js";
import type { GroundingViolation } from "../src/index.js";

/** Build one round's violation list from [claim, certainty] pairs. */
function round(...vs: [string, number][]): GroundingViolation[] {
  return vs.map(([claim, certainty]) => ({ claim, reason: "not in sources", certainty }));
}

describe("claimSimilarity", () => {
  test("token-identical claims (ignoring case/punctuation) score 1.0", () => {
    const a = "Algolia applies typo tolerance during matching.";
    const b = "algolia applies typo tolerance during matching";
    expect(claimSimilarity(a, b)).toBe(1.0);
  });

  test("claims with no shared meaningful tokens score 0", () => {
    const a = "vector search compares numeric embeddings";
    const b = "facetFilters restrict results to selected refinements";
    expect(claimSimilarity(a, b)).toBe(0);
  });

  test("inflection variants of the same claim count as the same (stemming)", () => {
    // Real judges write 'compares'/'comparing', 'retrieve'/'retrieves',
    // 'source'/'sources' for the SAME claim — these must match.
    const a = "vector search compares embeddings to retrieve sources";
    const b = "vector search comparing embedding retrieves source";
    expect(claimSimilarity(a, b)).toBe(1.0);
  });
});

describe("clusterRoundViolations", () => {
  const opts = { simThreshold: 0.5, minConfidence: 0.3 };

  test("the SAME claim flagged across rounds clusters into one, recurrence counts distinct rounds", () => {
    const perRound = [
      round(["Algolia applies typo tolerance during matching", 0.6]),
      round(["Algolia applies typo tolerance while matching queries", 0.55]),
      round(["typo tolerance is applied during matching by Algolia", 0.7]),
    ];
    const clusters = clusterRoundViolations(perRound, opts);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].roundsFlagged).toBe(3);
    expect(clusters[0].recurrenceFraction).toBeCloseTo(1.0);
  });

  test("heterogeneous one-off claims do NOT merge — each recurs in only 1/3 rounds", () => {
    const perRound = [
      round(["vector search uses numeric embeddings", 0.8]),
      round(["facetFilters restrict to selected refinements", 0.8]),
      round(["NeuralSearch blends keyword and semantic ranking", 0.8]),
    ];
    const clusters = clusterRoundViolations(perRound, opts);
    expect(clusters).toHaveLength(3);
    expect(Math.max(...clusters.map((c) => c.recurrenceFraction))).toBeCloseTo(1 / 3);
  });

  test("a flag below minConfidence is ignored (noise floor)", () => {
    const perRound = [
      round(["typo tolerance applied during matching", 0.1]),
      round(["typo tolerance applied during matching", 0.1]),
    ];
    expect(clusterRoundViolations(perRound, opts)).toHaveLength(0);
  });

  test("multiple flags of one claim within a single round count that round once", () => {
    const perRound = [
      round(
        ["typo tolerance applied during matching", 0.6],
        ["typo tolerance applied during matching by Algolia", 0.6],
      ),
      round(["typo tolerance applied during matching", 0.6]),
    ];
    const clusters = clusterRoundViolations(perRound, opts);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].roundsFlagged).toBe(2);
  });
});

describe("evaluateClaimGate", () => {
  test("a claim recurring in a supermajority of rounds TRIPS the gate", () => {
    // Realistic input: judges quote the same offending span with minor variation.
    const perRound = [
      round(["vector search retrieves by comparing numeric embeddings", 0.6]),
      round(["vector search retrieves results by comparing numeric embeddings", 0.5]),
      round(["vector search compares numeric embeddings to retrieve results", 0.7]),
      round(["vector search retrieves by comparing numeric embeddings vectors", 0.55]),
    ];
    const out = evaluateClaimGate(perRound, DEFAULT_CLAIM_GATE);
    expect(out.tripped).toBe(true);
    expect(out.decidingCluster?.roundsFlagged).toBe(4);
  });

  test("heterogeneous one-off flags (no claim recurs) do NOT trip", () => {
    const perRound = [
      round(["claim A unsupported", 0.9]),
      round(["totally different claim B unsupported", 0.9]),
      round(["yet another distinct claim C unsupported", 0.9]),
    ];
    expect(evaluateClaimGate(perRound, DEFAULT_CLAIM_GATE).tripped).toBe(false);
  });

  // The anti-flicker guarantee: the SAME real claim flagged every round, but with
  // confidence wobbling across the old 0.7 cutoff, must STILL trip stably — the
  // decision is recurrence, not whether confidence crossed a sharp line.
  test("same claim, confidence wobbling around the old cutoff, trips stably", () => {
    const wobble = [0.62, 0.78, 0.55, 0.81, 0.6];
    const perRound = wobble.map((c) =>
      round(["the lead definition sentence is ungrounded", c]),
    );
    const out = evaluateClaimGate(perRound, DEFAULT_CLAIM_GATE);
    expect(out.tripped).toBe(true);
    expect(out.decidingCluster?.recurrenceFraction).toBeCloseTo(1.0);
  });

  test("no violations at all → not tripped", () => {
    expect(evaluateClaimGate([round(), round(), round()], DEFAULT_CLAIM_GATE).tripped).toBe(false);
  });
});
