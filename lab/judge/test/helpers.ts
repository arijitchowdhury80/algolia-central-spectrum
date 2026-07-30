import type {
  Artifact,
  DimensionScore,
  Judgment,
  LlmComplete,
  Temperament,
} from "../src/index.js";
import { ALGOLIA_ANSWER_RUBRIC, weightedAggregate } from "../src/index.js";

/** A grounded answer artifact with two supporting sources. */
export const GROUNDED_ARTIFACT: Artifact = {
  type: "algolia-answer",
  prompt: "Does Algolia support typo tolerance?",
  content:
    "Yes. Algolia provides typo tolerance out of the box [S1], configurable per index [S2].",
  sources: [
    { id: "S1", text: "Algolia includes typo tolerance by default on all indices." },
    { id: "S2", text: "Typo tolerance can be configured per index via settings." },
  ],
  notApplicableDimensions: ["engagement"],
};

/** Builds full dimension scores for the default rubric at one flat value. */
export function flatScores(value: number, omit: string[] = ["engagement"]): DimensionScore[] {
  return ALGOLIA_ANSWER_RUBRIC.dimensions
    .filter((d) => !omit.includes(d.id))
    .map((d) => ({ dimensionId: d.id, score: value, rationale: "test" }));
}

/** Builds a Judgment with a flat score and computed weighted aggregate. */
export function makeJudgment(
  judgeId: string,
  temperament: Temperament,
  flatValue: number,
  violations: { confidence: number; kind?: "contradicted" | "unverifiable" }[] = [],
): Judgment {
  const dimensionScores = flatScores(flatValue);
  return {
    judgeId,
    temperament,
    dimensionScores,
    groundingViolations: violations.map((v, i) => ({
      claim: `claim ${i}`,
      reason: "not in sources",
      certainty: v.confidence,
      ...(v.kind ? { kind: v.kind } : {}),
    })),
    summary: `${judgeId} verdict`,
    weightedScore: weightedAggregate(dimensionScores, ALGOLIA_ANSWER_RUBRIC, {
      notApplicableDimensions: ["engagement"],
    }),
  };
}

/**
 * A scripted mock LLM. Returns judge JSON keyed by the persona/temperament found
 * in the prompt, and a fixed synthesizer rationale. NEVER touches the network.
 */
export function makeMockLlm(opts: {
  skepticScore: number;
  refereeScore: number;
  advocateScore: number;
  skepticViolations?: { confidence: number }[];
  rationale?: string;
}): { llm: LlmComplete; calls: { prompt: string; tag?: string }[] } {
  const calls: { prompt: string; tag?: string }[] = [];
  const judgeJson = (score: number, violations: { confidence: number }[] = []) =>
    JSON.stringify({
      dimensionScores: flatScores(score).map((d) => ({
        dimensionId: d.dimensionId,
        score: d.score,
        rationale: "mock",
      })),
      groundingViolations: violations.map((v, i) => ({
        claim: `claim ${i}`,
        reason: "not supported by sources",
        certainty: v.confidence,
      })),
      summary: `mock summary @${score}`,
    });

  const llm: LlmComplete = async (prompt, o) => {
    calls.push({ prompt, tag: o?.tag });
    if (o?.tag?.startsWith("synthesizer")) {
      return opts.rationale ?? "Mock chief synthesizer rationale.";
    }
    if (prompt.includes("CONTRARIAN skeptic")) {
      return judgeJson(opts.skepticScore, opts.skepticViolations ?? []);
    }
    if (prompt.includes("NEUTRAL referee")) {
      return judgeJson(opts.refereeScore);
    }
    if (prompt.includes("generous ADVOCATE")) {
      return judgeJson(opts.advocateScore);
    }
    throw new Error("Mock LLM: unrecognised prompt.");
  };

  return { llm, calls };
}
