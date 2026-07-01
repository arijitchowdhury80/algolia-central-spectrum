import type {
  HardGateConfig,
  JudgeConfig,
  JudgeProfile,
  Rubric,
  SynthesisConfig,
} from "./types.js";

/**
 * Default rubric for the Algolia answer-quality experiment — 4-dimension model
 * (Arijit, 2026-06-27). The composite ("Confidence") is a simple equal-weight (x1)
 * mean across four facets: Grounding, Coverage, Depth, and Relevance. Grounding is
 * NOT up-weighted in the average; instead it is the HARD FLOOR — a verified
 * grounding violation still caps the whole score via the gate (see DEFAULT_GATE /
 * aggregateRounds), independent of its weight.
 *
 * History: the earlier 3-dimension model (grounding / answer-confidence /
 * breadth_depth) was refactored — the fused "breadth_depth" split into Coverage
 * (did it address every part of the question) + Depth (did it go deep on what it
 * covered); the old decisiveness "confidence" dimension was dropped (its
 * over-refusal signal folds into Coverage); Relevance (does it answer THIS user's
 * situation) was added. See docs/superpowers/specs/2026-06-27-judge-confidence-refactor-design.md.
 */
export const ALGOLIA_ANSWER_RUBRIC: Rubric = {
  name: "Algolia answer quality v3 (4-dimension)",
  min: 1,
  max: 10,
  dimensions: [
    {
      id: "grounding",
      label: "Grounding",
      description:
        "Is EVERY factual claim traceable to a provided source, with no hallucination or unsupported assertion? Citations must actually support the claim they attach to. This is CRITICAL — score conservatively; even one unsupported claim is a serious problem. (An honest 'this isn't covered' statement or a routing link to official help is NOT a violation.)",
      weight: 1,
    },
    {
      id: "coverage",
      label: "Coverage",
      description:
        "Did the answer address EVERY part of the question — each entity/signal the user surfaced (industry, role, use-case, problem, product, topic)? When the artifact lists EXPECTED COVERAGE entities, treat them as the checklist and reward addressing each. A complete answer surfaces available information rather than needlessly refusing; penalise partial answers that ignore parts of the question, or that refuse/defer when the sources actually support an answer.",
      weight: 1,
    },
    {
      id: "depth",
      label: "Depth",
      description:
        "For what it covers, does the answer go DEEP — mechanism, specific parameters/settings/names, numbers, trade-offs, and nuance the sources provide — in a clear, logically layered structure? Reward substantive, specific, well-organised answers; penalise thin, shallow, or padded ones. Depth must come from the sources, not padding.",
      weight: 1,
    },
    {
      id: "relevance",
      label: "Relevance",
      description:
        "Does the answer address THIS user's specific situation and question, not a generic version? Reward answers tailored to the user's stated context (their role, industry, problem); penalise generic boilerplate that ignores what the user actually asked.",
      weight: 1,
    },
  ],
};

/**
 * The three blind judge personas. Identity of the pipeline is never revealed.
 *
 * ALL judges run at temperature 0 (zero-flicker policy, 2026-06-13): determinism
 * comes from temperature 0; perspective diversity comes from the distinct PERSONAS
 * below, NOT from random sampling. A nonzero temperature on the gating Skeptic was
 * the primary source of grounding-gate flicker (its violation-detection wobbled
 * across runs). The claim-recurrence gate is the safety net for any residual
 * provider nondeterminism; temperature 0 removes it at the source.
 */
export const DEFAULT_JUDGES: readonly JudgeProfile[] = [
  {
    id: "skeptic",
    temperament: "skeptic",
    temperature: 0.0,
    persona:
      "You are a CONTRARIAN skeptic. Hunt for hallucination, unsupported claims, fluff, broken logic, and citations that do not actually back the claim they attach to. Assume the answer is wrong until the sources prove it right. Score conservatively: when in doubt, score lower. Flag every claim you cannot map to a provided source as a grounding violation with your confidence.",
  },
  {
    id: "referee",
    temperament: "referee",
    temperature: 0.0,
    persona:
      "You are a NEUTRAL referee. Apply the rubric literally and dispassionately. Do not reward effort or punish ambition — score exactly what the rubric describes, no more, no less.",
  },
  {
    id: "advocate",
    temperament: "advocate",
    temperature: 0.0,
    persona:
      "You are a generous ADVOCATE who believes the answer is trying to help. Reward genuine depth, helpfulness, layered teaching, completeness, and engagement. Give credit for substance. You still must not excuse fabricated facts — grounding is non-negotiable — but everywhere else, find the value.",
  },
];

export const DEFAULT_GATE: HardGateConfig = {
  groundingGateEnabled: true,
  cap: 3,
  verifiedConfidence: 0.7,
  gatingTemperaments: ["skeptic"],
};

/**
 * Final pre-gate score = the simple MEAN of the three judges' composites
 * (Arijit, 2026-06-18: "final = average of the 3 judges"). The skeptic still
 * governs the grounding HARD FLOOR via the gate; it is no longer up-weighted in
 * the quality average. The "trimmed-skeptic-weighted" rule remains available for
 * callers that want it, but is no longer the default.
 */
export const DEFAULT_SYNTHESIS: SynthesisConfig = {
  rule: "mean",
};

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  rubric: ALGOLIA_ANSWER_RUBRIC,
  judges: DEFAULT_JUDGES,
  gate: DEFAULT_GATE,
  synthesis: DEFAULT_SYNTHESIS,
};

/**
 * The set of rubric dimensions that apply to a given artifact: drops optional
 * dimensions the artifact explicitly marks not-applicable.
 */
export function applicableDimensions(
  rubric: Rubric,
  notApplicable: readonly string[] = [],
) {
  const skip = new Set(notApplicable);
  return rubric.dimensions.filter((d) => !(d.optional && skip.has(d.id)));
}
