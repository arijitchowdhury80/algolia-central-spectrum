import { describe, expect, it } from "vitest";
import {
  ALGOLIA_ANSWER_RUBRIC,
  DEFAULT_JUDGE_CONFIG,
  judgeArtifact,
  judgeArtifactMultiRound,
  type LlmComplete,
} from "../src/index.js";
import { GROUNDED_ARTIFACT, makeMockLlm } from "./helpers.js";

describe("judgeArtifact (end-to-end with a MOCKED llm — no network)", () => {
  it("runs all three judges + the synthesizer and returns a final score", async () => {
    const { llm, calls } = makeMockLlm({
      skepticScore: 7,
      refereeScore: 8,
      advocateScore: 9,
      rationale: "Panel broadly agrees; well grounded.",
    });

    const result = await judgeArtifact(GROUNDED_ARTIFACT, DEFAULT_JUDGE_CONFIG, llm);

    expect(result.judgments).toHaveLength(3);
    expect(result.synthesis.gate.tripped).toBe(false);
    expect(result.synthesis.finalScore).toBeGreaterThan(0);
    expect(result.synthesis.rationale).toBe("Panel broadly agrees; well grounded.");

    // 3 judge calls + 1 synthesizer call.
    expect(calls).toHaveLength(4);
    expect(calls.filter((c) => c.tag?.startsWith("judge:"))).toHaveLength(3);
    expect(calls.filter((c) => c.tag?.startsWith("synthesizer"))).toHaveLength(1);
  });

  it("caps the final score when the mocked skeptic returns a verified violation", async () => {
    const { llm } = makeMockLlm({
      skepticScore: 9,
      refereeScore: 9,
      advocateScore: 10,
      skepticViolations: [{ confidence: 0.9 }],
    });

    const result = await judgeArtifact(GROUNDED_ARTIFACT, DEFAULT_JUDGE_CONFIG, llm);

    expect(result.synthesis.gate.tripped).toBe(true);
    expect(result.synthesis.finalScore).toBe(DEFAULT_JUDGE_CONFIG.gate.cap);
  });

  it("tracks variance across multiple rounds", async () => {
    const { llm } = makeMockLlm({ skepticScore: 7, refereeScore: 7, advocateScore: 7 });
    const multi = await judgeArtifactMultiRound(
      GROUNDED_ARTIFACT,
      DEFAULT_JUDGE_CONFIG,
      llm,
      3,
    );
    expect(multi.stats.rounds).toBe(3);
    // Deterministic mock -> identical rounds -> zero variance.
    expect(multi.stats.stdDevFinalScore).toBe(0);
    expect(multi.stats.anyGateTripped).toBe(false);
  });

  it("exposes a stable voted-gate aggregate and authors ONE rationale across rounds", async () => {
    const { llm, calls } = makeMockLlm({
      skepticScore: 7,
      refereeScore: 8,
      advocateScore: 8,
      rationale: "Stable across rounds.",
    });
    const multi = await judgeArtifactMultiRound(
      GROUNDED_ARTIFACT,
      DEFAULT_JUDGE_CONFIG,
      llm,
      3,
    );
    // 3 rounds x 3 judges = 9 judge calls; the synthesizer is called at most ONCE
    // (no per-round rationale waste).
    expect(calls.filter((c) => c.tag?.startsWith("judge:"))).toHaveLength(9);
    expect(calls.filter((c) => c.tag?.startsWith("synthesizer")).length).toBeLessThanOrEqual(1);

    expect(multi.aggregate.rounds).toBe(3);
    expect(multi.aggregate.gateTripped).toBe(false);
    expect(multi.aggregate.stdDevPreGateScore).toBe(0); // deterministic mock
    expect(multi.aggregate.finalScore).toBeCloseTo(multi.aggregate.meanPreGateScore, 5);
    expect(multi.aggregate.finalScore).toBeGreaterThan(DEFAULT_JUDGE_CONFIG.gate.cap);
  });

  it("retries a judge call when the model emits unparseable JSON, then succeeds", async () => {
    // Gemini occasionally emits a stray token producing invalid JSON; a single
    // such glitch must NOT crash judging — the call is retried.
    let skepticCalls = 0;
    const validSkeptic = JSON.stringify({
      dimensionScores: ALGOLIA_ANSWER_RUBRIC.dimensions
        .filter((d) => d.id !== "engagement")
        .map((d) => ({ dimensionId: d.id, score: 7, rationale: "ok" })),
      groundingViolations: [],
      summary: "ok",
    });
    const validOther = (score: number) =>
      JSON.stringify({
        dimensionScores: ALGOLIA_ANSWER_RUBRIC.dimensions
          .filter((d) => d.id !== "engagement")
          .map((d) => ({ dimensionId: d.id, score, rationale: "ok" })),
        groundingViolations: [],
        summary: "ok",
      });
    const llm: LlmComplete = async (prompt, o) => {
      if (o?.tag?.startsWith("synthesizer")) return "rationale";
      if (prompt.includes("CONTRARIAN skeptic")) {
        skepticCalls++;
        if (skepticCalls === 1) return '{ "dimensionScores": [ }, e { ] '; // garbage
        return validSkeptic;
      }
      if (prompt.includes("NEUTRAL referee")) return validOther(8);
      if (prompt.includes("generous ADVOCATE")) return validOther(8);
      throw new Error("unexpected judge prompt");
    };

    const result = await judgeArtifact(GROUNDED_ARTIFACT, DEFAULT_JUDGE_CONFIG, llm);
    expect(skepticCalls).toBe(2); // retried once after the bad JSON
    expect(result.judgments).toHaveLength(3);
    expect(result.synthesis.finalScore).toBeGreaterThan(0);
  });

  it("votes the gate TRIPPED only when violations reproduce across rounds", async () => {
    const { llm } = makeMockLlm({
      skepticScore: 9,
      refereeScore: 9,
      advocateScore: 10,
      skepticViolations: [{ confidence: 0.9 }],
    });
    const multi = await judgeArtifactMultiRound(
      GROUNDED_ARTIFACT,
      DEFAULT_JUDGE_CONFIG,
      llm,
      3,
    );
    expect(multi.aggregate.gateTripFraction).toBe(1);
    expect(multi.aggregate.gateTripped).toBe(true);
    expect(multi.aggregate.finalScore).toBe(DEFAULT_JUDGE_CONFIG.gate.cap);
  });
});
