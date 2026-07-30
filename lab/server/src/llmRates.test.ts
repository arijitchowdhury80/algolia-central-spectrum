import { describe, it, expect } from "vitest";
import { LLM_RATES, costUsd } from "./llmRates.js";

describe("llmRates", () => {
  it("has the 4 published rates the cost-tracking spec names", () => {
    expect(Object.keys(LLM_RATES).sort()).toEqual(
      ["gemini-2.5-flash", "gemini-2.5-pro", "gpt-4o", "gpt-4o-mini"].sort(),
    );
  });

  it("computes cost as tokens/1e6 * rate, input and output priced independently", () => {
    // gemini-2.5-flash: $0.30 in / $2.50 out per 1M.
    const cost = costUsd("gemini-2.5-flash", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.3 + 2.5, 6);
  });

  it("scales linearly with token count", () => {
    const half = costUsd("gpt-4o-mini", 500_000, 0);
    const full = costUsd("gpt-4o-mini", 1_000_000, 0);
    expect(full).toBeCloseTo((half ?? 0) * 2, 6);
  });

  it("zero tokens costs zero", () => {
    expect(costUsd("gemini-2.5-pro", 0, 0)).toBe(0);
  });

  it("returns undefined (never fabricates) for an unpriced model", () => {
    expect(costUsd("some-future-model", 1000, 1000)).toBeUndefined();
  });
});
