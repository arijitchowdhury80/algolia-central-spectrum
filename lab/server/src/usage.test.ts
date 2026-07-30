import { describe, it, expect, vi } from "vitest";
import type { LlmComplete, LlmCompleteOptions, LlmUsage } from "@lab/judge";
import { withUsageCapture, summarizeUsage, type UsageCall } from "./usage.js";

describe("withUsageCapture", () => {
  it("pushes the provider's onUsage call onto the sink, tagged", async () => {
    const fakeLlm: LlmComplete = async (_prompt, opts) => {
      opts?.onUsage?.({ inputTokens: 100, outputTokens: 50, model: "gemini-2.5-flash", tag: opts.tag });
      return "ok";
    };
    const calls: UsageCall[] = [];
    const wrapped = withUsageCapture(fakeLlm, (u) => calls.push(u));

    await wrapped("hello", { tag: "judge:skeptic:round1" });

    expect(calls).toEqual([
      { tag: "judge:skeptic:round1", model: "gemini-2.5-flash", inputTokens: 100, outputTokens: 50 },
    ]);
  });

  it("accumulates across multiple calls (many judge personas per request)", async () => {
    let n = 0;
    const fakeLlm: LlmComplete = async (_prompt, opts) => {
      n += 1;
      opts?.onUsage?.({ inputTokens: n * 10, outputTokens: n * 5, model: "gemini-2.5-pro" });
      return "ok";
    };
    const calls: UsageCall[] = [];
    const wrapped = withUsageCapture(fakeLlm, (u) => calls.push(u));

    await wrapped("a");
    await wrapped("b");
    await wrapped("c");

    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.inputTokens)).toEqual([10, 20, 30]);
  });

  it("still calls through to a caller-provided onUsage (chaining, not replacing)", async () => {
    const fakeLlm: LlmComplete = async (_prompt, opts) => {
      opts?.onUsage?.({ inputTokens: 1, outputTokens: 1, model: "gpt-4o" });
      return "ok";
    };
    const sinkCalls: UsageCall[] = [];
    const wrapped = withUsageCapture(fakeLlm, (u) => sinkCalls.push(u));

    const callerOnUsage = vi.fn<(u: LlmUsage) => void>();
    const opts: LlmCompleteOptions = { onUsage: callerOnUsage };
    await wrapped("x", opts);

    expect(sinkCalls).toHaveLength(1);
    expect(callerOnUsage).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on the sink when the provider reports no usage", async () => {
    const fakeLlm: LlmComplete = async () => "ok"; // never calls onUsage
    const calls: UsageCall[] = [];
    const wrapped = withUsageCapture(fakeLlm, (u) => calls.push(u));
    await wrapped("x");
    expect(calls).toHaveLength(0);
  });
});

describe("summarizeUsage", () => {
  it("sums tokens and prices known-model calls", () => {
    const calls: UsageCall[] = [
      { model: "gemini-2.5-flash", inputTokens: 1_000_000, outputTokens: 1_000_000, tag: "judge:skeptic:round1" },
      { model: "gemini-2.5-flash", inputTokens: 500_000, outputTokens: 0, tag: "followup-quality" },
    ];
    const summary = summarizeUsage(calls);
    expect(summary.totalInputTokens).toBe(1_500_000);
    expect(summary.totalOutputTokens).toBe(1_000_000);
    // (0.30+2.50) + 0.15 = 2.95
    expect(summary.estimatedCostUsd).toBeCloseTo(2.95, 6);
    expect(summary.hasUnpricedCalls).toBe(false);
    expect(summary.calls).toBe(calls);
  });

  it("excludes unpriced-model calls from the cost sum and flags them, without dropping their tokens", () => {
    const calls: UsageCall[] = [
      { model: "some-future-model", inputTokens: 1000, outputTokens: 1000 },
      { model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 },
    ];
    const summary = summarizeUsage(calls);
    expect(summary.totalInputTokens).toBe(1_001_000);
    expect(summary.hasUnpricedCalls).toBe(true);
    expect(summary.estimatedCostUsd).toBeCloseTo(0.15, 6); // only the priced call counted
  });

  it("empty calls -> all zeros, not unpriced", () => {
    const summary = summarizeUsage([]);
    expect(summary).toEqual({
      calls: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      hasUnpricedCalls: false,
    });
  });
});
