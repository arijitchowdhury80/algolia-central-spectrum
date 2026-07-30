import type {
  HardGateConfig,
  JudgeConfig,
  JudgeProfile,
  Rubric,
  SynthesisConfig,
} from "./types.js";

/**
 * USEFULNESS — the ONE dimension the panel scores under the Phase 2 rebuild.
 * Injected verbatim into the judge prompt — kept as its own exported
 * const so tests can assert it word-for-word and the prompt/rubric never
 * drift apart.
 *
 * Refined against 6 real captured fixtures (see the spec's fixture->anchor
 * mapping): the key change from the earlier draft is that the 9-10 band does
 * NOT require a compiling code block — real high-quality corpus answers are
 * often process/prose explanations that name the exact APIs. A code example
 * is a PLUS for code-shaped questions, not a gate on them.
 */
export const USEFULNESS_DESCRIPTION = `USEFULNESS — the ONE thing you score, 1–10: "Does this give the person
everything they need to act on their question?" Judge completeness and
concrete specificity ONLY. Do NOT lower this score for grounding doubts —
unsupported-claim hunting is a SEPARATE output (groundingViolations); score
Usefulness as if the stated facts hold.

  9–10 — Addresses every part of the question with concrete, corpus-real
         specifics: actual prop / component / API / token names, exact
         values, or step-by-step mechanics that a reader could apply
         directly. For a code-shaped question, a usable code example (or a
         precise step list naming every handler/prop involved) pushes into
         this band; prose that names all the real specifics also qualifies.
  6–8  — Addresses the core of the question with real specifics, but leaves a
         secondary part of a multi-part question thin, OR is specific without
         being complete (e.g. names the mechanism but not the exact values,
         or explains the concept but omits one handler/prop the task needs).
  3–5  — Answers *a* question in the neighbourhood but stays generic: it could
         apply to several different questions in this corpus, names no
         specifics that pin it to THIS question, and gives no code where one
         was clearly warranted.
  1–2  — Doesn't address what was actually asked, or is contentless filler.`;

/**
 * Default rubric for the Algolia answer-quality experiment — Phase 2 rebuild
 * (2026-07-19): collapses the old 4-dimension model (grounding / coverage /
 * depth / relevance) into a SINGLE scored dimension, Usefulness. Grounding
 * stops being a scored number entirely and becomes purely the corroboration
 * gate (see DEFAULT_GATE, gate.ts) — the two axes are deliberately kept
 * orthogonal: a judge is told NOT to dock Usefulness for grounding doubts.
 *
 * History: v3 (4-dimension: grounding/coverage/depth/relevance) preceded this
 * rebuild. v4 (this rebuild) was written after a solo-Skeptic flag was found
 * capping high-quality answers (9/9/9 → 3.10) because grounding, as a scored
 * dimension AND the gate input, let one judge's doubt both lower the
 * composite and cap it.
 */
export const ALGOLIA_ANSWER_RUBRIC: Rubric = {
  name: "Algolia answer quality v4 (usefulness + grounding gate)",
  min: 1,
  max: 10,
  dimensions: [
    {
      id: "usefulness",
      label: "Usefulness",
      description: USEFULNESS_DESCRIPTION,
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

/**
 * Phase 2 corroboration gate config (spec §1.3/§3.3): the score is capped only
 * when >= corroborationThreshold (2) of the 3 judges independently flag the
 * same claim cluster (claimSimThreshold 0.5) as "contradicted" at >=
 * verifiedConfidence (0.7). `gatingTemperaments` is kept for back-compat with
 * the OLD single-round evaluateHardGate; the new corroboration gate ignores
 * temperament — any 2 of the 3 judges corroborate.
 */
export const DEFAULT_GATE: HardGateConfig = {
  groundingGateEnabled: true,
  // 2026-07-28 decision: only the deterministic verbatim check may cap the
  // served score. The LLM panel still runs and its findings are surfaced as
  // advisory, but they no longer move the number — measured, the LLM gate
  // returned {3.00, 8.89} on identical input and multi-round voting did not
  // fix it. See HardGateConfig.groundingMode for the full evidence.
  groundingMode: "deterministic",
  cap: 3,
  verifiedConfidence: 0.7,
  // 2026-07-28: absent-from-corpus claims now gate, at a higher confidence bar
  // than contradictions. The product requirement is that nothing outside the
  // corpus reaches the user, and hallucination usually invents rather than
  // contradicts — so a contradiction-only gate did not enforce the requirement
  // it was believed to enforce. Safe to enable only because source truncation
  // was fixed the same day; see HardGateConfig.gateOnUnverifiable.
  gateOnUnverifiable: true,
  unverifiableConfidence: 0.8,
  corroborationThreshold: 2,
  claimSimThreshold: 0.5,
  gatingTemperaments: ["skeptic", "referee", "advocate"],
};

/**
 * Final pre-gate score = the simple MEAN of the three judges' composites
 * (2026-06-18 decision: "final = average of the 3 judges"). The skeptic still
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
