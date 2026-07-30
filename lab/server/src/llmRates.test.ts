import { describe, it, expect } from "vitest";
import { LLM_RATES, costUsd } from "./llmRates.js";

describe("llmRates", () => {
  it("has the 2 published rates the cost-tracking spec names", () => {
    expect(Object.keys(LLM_RATES).sort()).toEqual(["gpt-4o", "gpt-4o-mini"].sort());
  });

  it("computes cost as tokens/1e6 * rate, input and output priced independently", () => {
    // gpt-4o: $2.50 in / $10.00 out per 1M.
    const cost = costUsd("gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(2.5 + 10.0, 6);
  });

  it("scales linearly with token count", () => {
    const half = costUsd("gpt-4o-mini", 500_000, 0);
    const full = costUsd("gpt-4o-mini", 1_000_000, 0);
    expect(full).toBeCloseTo((half ?? 0) * 2, 6);
  });

  it("zero tokens costs zero", () => {
    expect(costUsd("gpt-4o", 0, 0)).toBe(0);
  });

  it("returns undefined (never fabricates) for an unpriced model", () => {
    expect(costUsd("some-future-model", 1000, 1000)).toBeUndefined();
  });
});
