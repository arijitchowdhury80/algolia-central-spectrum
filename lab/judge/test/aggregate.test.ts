import { describe, expect, it } from "vitest";
import {
  ALGOLIA_ANSWER_RUBRIC,
  applicableDimensions,
  toFinalScale,
  weightedAggregate,
} from "../src/index.js";
import { flatScores } from "./helpers.js";

describe("weightedAggregate", () => {
  it("returns the flat value when every dimension scores the same", () => {
    const scores = flatScores(8);
    const agg = weightedAggregate(scores, ALGOLIA_ANSWER_RUBRIC);
    expect(agg).toBe(8);
  });

  it("composite is the equal-weighted mean of the 4 dimensions (grounding x1)", () => {
    // grounding 9, coverage 6, depth 6, relevance 9 -> mean = (9+6+6+9)/4 = 7.5.
    // Grounding is NOT up-weighted; the composite is on the rubric's own 1-10
    // scale (toFinalScale rescaling is verified separately below).
    const dims = [
      { dimensionId: "grounding", score: 9, rationale: "test" },
      { dimensionId: "coverage", score: 6, rationale: "test" },
      { dimensionId: "depth", score: 6, rationale: "test" },
      { dimensionId: "relevance", score: 9, rationale: "test" },
    ];
    const composite = weightedAggregate(dims, ALGOLIA_ANSWER_RUBRIC);
    expect(composite).toBeCloseTo(7.5, 5);
  });

  it("weights all 4 dimensions equally: any single low dimension pulls the mean the same", () => {
    // 4 dims, all weight 1 -> total weight 4 (equal weighting; grounding is x1).
    // All 10 except grounding=2 -> (2 + 10 + 10 + 10) / 4 = 32/4 = 8
    const scores = flatScores(10).map((d) =>
      d.dimensionId === "grounding" ? { ...d, score: 2 } : d,
    );
    const agg = weightedAggregate(scores, ALGOLIA_ANSWER_RUBRIC);
    expect(agg).toBeCloseTo(8, 5);

    // A low grounding and a low coverage pull the equal-weighted mean down by
    // exactly the same amount — grounding is no longer up-weighted in the score.
    // (the gate, not the weight, is what makes grounding the hard floor.)
    const scoresAlt = flatScores(10).map((d) =>
      d.dimensionId === "coverage" ? { ...d, score: 2 } : d,
    );
    const aggAlt = weightedAggregate(scoresAlt, ALGOLIA_ANSWER_RUBRIC);
    expect(aggAlt).toBeCloseTo(agg, 5);
    expect(aggAlt).toBeCloseTo(8, 5);
  });

  it("treats a missing dimension score as the rubric minimum (not free)", () => {
    const scores = flatScores(10).filter((d) => d.dimensionId !== "depth");
    const agg = weightedAggregate(scores, ALGOLIA_ANSWER_RUBRIC);
    // depth missing -> counted as min (1); all weights 1, total 4.
    // (10 + 10 + 10 + 1)/4 = 31/4 = 7.75
    expect(agg).toBeCloseTo(31 / 4, 5);
  });

  it("supports optional dimensions via the applicability filter", () => {
    // The 4-dimension production rubric has no optional dims; verify the
    // mechanism still works on a synthetic rubric with one.
    const withOptional = {
      ...ALGOLIA_ANSWER_RUBRIC,
      dimensions: [
        ...ALGOLIA_ANSWER_RUBRIC.dimensions,
        { id: "extra", label: "Extra", description: "", weight: 1, optional: true },
      ],
    };
    const all = applicableDimensions(withOptional, []);
    const dropped = applicableDimensions(withOptional, ["extra"]);
    expect(all.length).toBe(dropped.length + 1);
  });
});

describe("toFinalScale", () => {
  it("maps the rubric range onto 0-10", () => {
    expect(toFinalScale(10, ALGOLIA_ANSWER_RUBRIC)).toBeCloseTo(10, 5);
    expect(toFinalScale(1, ALGOLIA_ANSWER_RUBRIC)).toBeCloseTo(0, 5);
    // midpoint of 1..10 is 5.5 -> 0.5 of span -> 5.0
    expect(toFinalScale(5.5, ALGOLIA_ANSWER_RUBRIC)).toBeCloseTo(5, 5);
  });
});
