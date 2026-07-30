import { describe, expect, it } from "vitest";
import {
  ALGOLIA_ANSWER_RUBRIC,
  DEFAULT_JUDGE_CONFIG,
  judgeArtifact,
  judgeArtifactMultiRound,
  type LlmComplete,
} from "../src/index.js";
import { GROUNDED_ARTIFACT, makeMockLlm } from "./helpers.js";
import type { Artifact } from "../src/index.js";

/** The historical gate: LLM corroboration caps. Kept exercised so the machinery
 *  stays covered even though it no longer decides the served score. */
const LLM_GATE_CONFIG = {
  ...DEFAULT_JUDGE_CONFIG,
  gate: { ...DEFAULT_JUDGE_CONFIG.gate, groundingMode: "llm" as const },
};

/** Same answer/sources as GROUNDED_ARTIFACT plus one invented API name — the
 *  hallucination shape the deterministic check exists to catch. */
const FABRICATED_TERM_ARTIFACT: Artifact = {
  ...GROUNDED_ARTIFACT,
  content: `${GROUNDED_ARTIFACT.content} It is powered by QuantumTypoEngine.`,
};

/** Skeptic + Referee flag the SAME claim (corroborated); Advocate is clean. */
function corroboratingLlm(): LlmComplete {
  const claim = "shared claim 0";
  return async (prompt: string, o?: { tag?: string }) => {
    if (o?.tag?.startsWith("synthesizer")) return "Mock rationale.";
    const withViolations = (score: number, violated: boolean) =>
      JSON.stringify({
        dimensionScores: [{ dimensionId: "usefulness", score, rationale: "mock" }],
        groundingViolations: violated
          ? [{ claim, reason: "not supported", certainty: 0.9, kind: "contradicted" }]
          : [],
        summary: `mock @${score}`,
      });
    if (prompt.includes("CONTRARIAN skeptic")) return withViolations(9, true);
    if (prompt.includes("NEUTRAL referee")) return withViolations(9, true);
    if (prompt.includes("generous ADVOCATE")) return withViolations(10, false);
    throw new Error("unrecognised prompt");
  };
}

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

  it("does NOT cap when only the mocked skeptic returns a violation (solo, uncorroborated)", async () => {
    const { llm } = makeMockLlm({
      skepticScore: 9,
      refereeScore: 9,
      advocateScore: 10,
      skepticViolations: [{ confidence: 0.9 }],
    });

    const result = await judgeArtifact(GROUNDED_ARTIFACT, DEFAULT_JUDGE_CONFIG, llm);

    expect(result.synthesis.gate.tripped).toBe(false);
    // NOT borderline: the deterministic verdict has no threshold to be near, and
    // labelling a grounded 9.3 answer "BORDERLINE" contradicted every number
    // shown beside it (observed live, 2026-07-29).
    expect(result.synthesis.gate.borderline).toBe(false);
    expect(result.synthesis.finalScore).toBeGreaterThan(DEFAULT_JUDGE_CONFIG.gate.cap);
  });

  /**
   * 2026-07-28 behaviour change. Under the default config a
   * corroborated LLM cluster no longer caps: it is ADVISORY. The reason is
   * measured, not stylistic — the same answer scored {3.00, 8.89} across
   * identical runs of this path, because the panel's absence judgement is a
   * guess. What caps now is the deterministic verbatim check, which is a pure
   * function of (answer, sources).
   */
  it("does NOT cap on 2 corroborating judges when the answer is deterministically grounded", async () => {
    const result = await judgeArtifact(
      GROUNDED_ARTIFACT,
      DEFAULT_JUDGE_CONFIG,
      corroboratingLlm(),
    );

    expect(result.synthesis.gate.mode).toBe("deterministic");
    expect(result.synthesis.gate.tripped).toBe(false);
    // The evidence is still surfaced — advisory, not silently dropped.
    expect(result.synthesis.gate.advisoryClusters).toHaveLength(1);
    // ...but surfacing evidence is not the same as calling the verdict borderline.
    expect(result.synthesis.gate.borderline).toBe(false);
    expect(result.synthesis.finalScore).toBeGreaterThan(DEFAULT_JUDGE_CONFIG.gate.cap);
  });

  it("still caps on 2 corroborating judges under an explicit llm gate mode", async () => {
    const result = await judgeArtifact(GROUNDED_ARTIFACT, LLM_GATE_CONFIG, corroboratingLlm());

    expect(result.synthesis.gate.mode).toBe("llm");
    expect(result.synthesis.gate.tripped).toBe(true);
    expect(result.synthesis.finalScore).toBe(LLM_GATE_CONFIG.gate.cap);
  });

  it("caps on a fabricated API name even when every judge is happy", async () => {
    const { llm } = makeMockLlm({ skepticScore: 9, refereeScore: 9, advocateScore: 10 });
    const result = await judgeArtifact(FABRICATED_TERM_ARTIFACT, DEFAULT_JUDGE_CONFIG, llm);

    expect(result.synthesis.gate.mode).toBe("deterministic");
    expect(result.synthesis.gate.tripped).toBe(true);
    expect(result.synthesis.gate.deterministic?.unsupported.map((u) => u.term)).toContain(
      "QuantumTypoEngine",
    );
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
    // Some models occasionally emit a stray token producing invalid JSON; a single
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

  it("multi-round gate does NOT trip when only ONE judge (skeptic) flags across all rounds", async () => {
    // Phase 2: the gate is cross-JUDGE, not cross-round. The same solo judge
    // repeating a flag every round is still only ONE distinct judgeId.
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
    expect(multi.aggregate.gateTripFraction).toBe(0);
    expect(multi.aggregate.gateTripped).toBe(false);
    // Same rule across rounds: advisory flags never make a grounded verdict borderline.
    expect(multi.aggregate.borderline).toBe(false);
    expect(multi.aggregate.finalScore).toBeGreaterThan(DEFAULT_JUDGE_CONFIG.gate.cap);
  });

  it("multi-round gate TRIPS when 2 distinct judges corroborate the same claim, under llm mode", async () => {
    const multi = await judgeArtifactMultiRound(
      GROUNDED_ARTIFACT,
      LLM_GATE_CONFIG,
      corroboratingLlm(),
      3,
    );
    expect(multi.aggregate.gateMode).toBe("llm");
    expect(multi.aggregate.gateTripFraction).toBe(1);
    expect(multi.aggregate.gateTripped).toBe(true);
    expect(multi.aggregate.finalScore).toBe(LLM_GATE_CONFIG.gate.cap);
  });

  /**
   * The reproducibility property, end to end. This is the whole point of the
   * 2026-07-28 change: before it, this exact shape (corroborating judges on a
   * grounded answer) is what produced {3.00, 8.89} on identical input.
   */
  it("multi-round deterministic verdict is identical across rounds — no flicker", async () => {
    const multi = await judgeArtifactMultiRound(
      GROUNDED_ARTIFACT,
      DEFAULT_JUDGE_CONFIG,
      corroboratingLlm(),
      3,
    );
    expect(multi.aggregate.gateMode).toBe("deterministic");
    expect(multi.aggregate.gateTripped).toBe(false);
    expect(multi.aggregate.advisoryClusters).toHaveLength(1);
    expect(multi.stats.stdDevFinalScore).toBe(0);
    expect(new Set(multi.stats.finalScores).size).toBe(1);
  });
});
