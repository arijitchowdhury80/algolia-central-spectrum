import { describe, expect, it } from "vitest";
import {
  averageRanks,
  runCalibration,
  spearman,
  type CalibrationItem,
} from "../src/calibration.js";
import { DEFAULT_JUDGE_CONFIG } from "../src/rubric.js";
import { flatScores } from "./helpers.js";
import type { LlmComplete } from "../src/index.js";

describe("averageRanks", () => {
  it("ranks smallest as 1, no ties", () => {
    expect(averageRanks([10, 30, 20])).toEqual([1, 3, 2]);
  });

  it("averages tied ranks", () => {
    // two 20s share positions 2 and 3 → 2.5 each.
    expect(averageRanks([10, 20, 20, 40])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("handles all-equal values (every rank averaged to the middle)", () => {
    expect(averageRanks([5, 5, 5])).toEqual([2, 2, 2]);
  });
});

describe("spearman", () => {
  it("returns 1 for perfectly correlated vectors", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
  });

  it("returns -1 for exactly reversed vectors", () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it("matches a hand-worked example with no ties", () => {
    // Classic worked example: ranks differ by d = [-1, 1, 0] over n=3.
    //   a-ranks: [1, 2, 3]; b-ranks: [2, 1, 3]; d = [-1, 1, 0]; sum d^2 = 2.
    //   rho = 1 - 6*2 / (3*(9-1)) = 1 - 12/24 = 0.5.
    expect(spearman([1, 2, 3], [20, 10, 30])).toBeCloseTo(0.5, 10);
  });

  it("computes a correlation in the presence of ties", () => {
    // a has a tie at the top; correlation should be high but below 1.
    const rho = spearman([10, 10, 20, 30], [1, 2, 3, 4]);
    expect(rho).toBeGreaterThan(0.8);
    expect(rho).toBeLessThan(1);
  });

  it("throws on mismatched lengths", () => {
    expect(() => spearman([1, 2], [1, 2, 3])).toThrow(/equal length/);
  });

  it("throws on fewer than 2 points", () => {
    expect(() => spearman([1], [1])).toThrow(/at least 2/);
  });
});

/**
 * A mock LLM that scores each item by a number embedded in its answer text:
 * the answer must contain a marker "SCORE=<n>" which the mock reads back as the
 * flat dimension score. Lets the test fix the judge composite per item without
 * a network. The synthesizer call returns a fixed rationale.
 */
function makeScoreByMarkerLlm(): LlmComplete {
  return async (prompt, opts) => {
    if (opts?.tag?.startsWith("synthesizer")) return "mock rationale";
    const m = prompt.match(/SCORE=(\d+(?:\.\d+)?)/);
    const score = m ? Number(m[1]) : 5;
    return JSON.stringify({
      dimensionScores: flatScores(score, []).map((d) => ({
        dimensionId: d.dimensionId,
        score: d.score,
        rationale: "mock",
      })),
      groundingViolations: [],
      summary: `mock @${score}`,
    });
  };
}

function item(id: string, score: number, humanRank: number | null): CalibrationItem {
  return {
    id,
    question: `q for ${id}`,
    answer: `answer SCORE=${score}`,
    sources: [{ id: "S1", text: "supporting source" }],
    humanRank,
  };
}

describe("runCalibration", () => {
  it("ranks items by judge composite and correlates with human ranks", async () => {
    const llm = makeScoreByMarkerLlm();
    // human rank 1 (best) = highest score, descending — perfect agreement.
    const items: CalibrationItem[] = [
      item("a", 9, 1),
      item("b", 6, 2),
      item("c", 3, 3),
    ];
    const result = await runCalibration(items, DEFAULT_JUDGE_CONFIG, llm, 1);

    expect(result.n).toBe(3);
    // Judge ranks: highest composite (a) → rank 1.
    const byId = Object.fromEntries(result.perItem.map((p) => [p.id, p]));
    expect(byId.a.judgeRank).toBe(1);
    expect(byId.b.judgeRank).toBe(2);
    expect(byId.c.judgeRank).toBe(3);
    expect(byId.a.judgeComposite).toBeGreaterThan(byId.c.judgeComposite);
    expect(result.spearman).toBeCloseTo(1, 10);
  });

  it("returns spearman -1 when judge ordering is the reverse of human ranking", async () => {
    const llm = makeScoreByMarkerLlm();
    // human thinks a is best (rank 1) but the judge scores a lowest.
    const items: CalibrationItem[] = [
      item("a", 2, 1),
      item("b", 5, 2),
      item("c", 9, 3),
    ];
    const result = await runCalibration(items, DEFAULT_JUDGE_CONFIG, llm, 1);
    expect(result.spearman).toBeCloseTo(-1, 10);
  });

  it("skips items with a null human rank", async () => {
    const llm = makeScoreByMarkerLlm();
    const items: CalibrationItem[] = [
      item("a", 9, 1),
      item("b", 6, 2),
      item("unranked", 4, null),
    ];
    const result = await runCalibration(items, DEFAULT_JUDGE_CONFIG, llm, 1);
    expect(result.n).toBe(2);
    expect(result.perItem.map((p) => p.id)).not.toContain("unranked");
  });

  it("throws when fewer than 2 items are ranked", async () => {
    const llm = makeScoreByMarkerLlm();
    const items: CalibrationItem[] = [item("a", 9, 1), item("b", 6, null)];
    await expect(runCalibration(items, DEFAULT_JUDGE_CONFIG, llm, 1)).rejects.toThrow(
      /at least 2 ranked/,
    );
  });
});
