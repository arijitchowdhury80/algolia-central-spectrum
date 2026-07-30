/**
 * Core types for the AI Judge module.
 *
 * The judge scores an ARTIFACT (an answer, an idea, a story, an email, ...)
 * against a RUBRIC of weighted dimensions, using a PANEL of blind judges with
 * distinct temperaments, then a Chief Synthesizer reconciles the panel into a
 * single final score subject to HARD GATES.
 *
 * Nothing in this file (or any pure module) performs I/O. The only contact with
 * the outside world is an injected `LlmComplete` function — see provider.ts.
 */

import type { DeterministicGrounding } from "./detGround.js";

export type { DeterministicGrounding };

// ---------------------------------------------------------------------------
// Provider abstraction (no SDK is imported anywhere in this package)
// ---------------------------------------------------------------------------

/**
 * Exact token usage for ONE LlmComplete call, as reported by the provider's
 * own response (Gemini `usageMetadata`, OpenAI `usage`). Cost tracking
 * (spike plan §6) — this is the EXACT counterpart to the web client's
 * text-length ESTIMATE for Agent Studio calls, which exposes no usage at all.
 */
export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The concrete model string the call actually ran against (e.g. "gemini-2.5-flash"). */
  readonly model: string;
  /** Echoes the call's `tag`, if any, so a caller can attribute usage per call site. */
  readonly tag?: string;
}

export interface LlmCompleteOptions {
  /** Sampling temperature, if the provider supports it. */
  readonly temperature?: number;
  /** Hard cap on output tokens, if the provider supports it. */
  readonly maxTokens?: number;
  /** Optional system prompt, separated from the user prompt. */
  readonly system?: string;
  /** Free-form label used only for logging/tracing by the caller. */
  readonly tag?: string;
  /**
   * SINK, not a return value: providers that receive exact token counts in
   * their raw response (gemini.ts/openai.ts) invoke this synchronously before
   * resolving, when usage is present. Deliberately a callback rather than a
   * widened `LlmComplete` return type (`Promise<string>` stays unchanged
   * everywhere) — see lab/server/src/usage.ts for the accumulator that wraps
   * an LlmComplete to collect these into a per-request summary.
   */
  readonly onUsage?: (usage: LlmUsage) => void;
}

/**
 * The single seam between this module and any real LLM. The backend injects a
 * concrete implementation (OpenAI, Anthropic, a local model, or a mock). The
 * module never imports a vendor SDK.
 */
export type LlmComplete = (
  prompt: string,
  opts?: LlmCompleteOptions,
) => Promise<string>;

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

/** A single scored dimension of the rubric. */
export interface RubricDimension {
  /** Stable machine id, e.g. "groundedness". */
  readonly id: string;
  /** Human label shown to judges, e.g. "Groundedness". */
  readonly label: string;
  /** What this dimension measures and how to score it 1-10. Shown to judges. */
  readonly description: string;
  /**
   * Aggregation weight. Default 1. The Algolia rubric keeps all dimensions at
   * equal weight (x1); grounding is enforced as the HARD FLOOR via the gate, not
   * by up-weighting it in the score.
   */
  readonly weight: number;
  /**
   * If true, this dimension is skipped when the artifact context says it does
   * not apply (e.g. Engagement/two-way only matters for conversational answers).
   */
  readonly optional?: boolean;
}

export interface Rubric {
  /** Human-readable rubric name, e.g. "Algolia answer quality v1". */
  readonly name: string;
  /** Inclusive lower bound of every dimension score. Default 1. */
  readonly min: number;
  /** Inclusive upper bound of every dimension score. Default 10. */
  readonly max: number;
  readonly dimensions: readonly RubricDimension[];
}

// ---------------------------------------------------------------------------
// Judge panel
// ---------------------------------------------------------------------------

export type Temperament = "skeptic" | "referee" | "advocate";

/** Definition of one judge persona. */
export interface JudgeProfile {
  /** Stable id used in results. */
  readonly id: string;
  readonly temperament: Temperament;
  /**
   * Persona instructions injected into the judge prompt. Describes the lens
   * (contrarian / neutral / believer) WITHOUT revealing which pipeline produced
   * the answer — blinding is enforced separately by the prompt builder.
   */
  readonly persona: string;
  /** Sampling temperature for this judge. */
  readonly temperature?: number;
}

// ---------------------------------------------------------------------------
// The thing being judged
// ---------------------------------------------------------------------------

/** A source the answer is allowed to rely on (the grounding corpus). */
export interface Source {
  /** Stable id the answer may cite, e.g. "S1" or a doc id. */
  readonly id: string;
  /** The supporting text. Groundedness is checked against THIS, not the world. */
  readonly text: string;
  /** Optional human label / URL for the rationale. */
  readonly label?: string;
}

/**
 * The artifact under judgement. Provider-agnostic and domain-agnostic: the same
 * shape judges an Algolia answer, a LinkedIn post, a short story, or a prompt.
 */
export interface Artifact {
  /** What kind of thing this is, e.g. "algolia-answer", "linkedin-post". */
  readonly type: string;
  /** The question / brief / task the artifact is responding to (optional). */
  readonly prompt?: string;
  /** The artifact text itself — the thing judges read and score. */
  readonly content: string;
  /**
   * Sources the artifact is allowed to ground itself in. Empty array means
   * "no external grounding required" (e.g. judging a creative story), in which
   * case the groundedness dimension / hard-gate is typically omitted.
   */
  readonly sources: readonly Source[];
  /**
   * Marks dimensions that do not apply to THIS artifact (e.g. omit
   * "engagement" for a one-shot answer). Optional dimensions in this set are
   * dropped from scoring and aggregation.
   */
  readonly notApplicableDimensions?: readonly string[];
  /**
   * Expected behaviour for THIS artifact. "refuse" marks an out-of-scope or
   * unanswerable prompt where the CORRECT response is a brief refusal that
   * routes the user elsewhere: judges score a clean refusal HIGH and treat a
   * substantive factual answer as a grounding failure. Default "answer".
   */
  readonly expectedBehavior?: "answer" | "refuse";
  /**
   * The parts of the question the answer is expected to cover — the entities /
   * discovery signals the upstream pipeline already extracted for THIS turn
   * (no new extraction). Feeds the Coverage dimension as its per-turn checklist:
   * the judge rewards an answer that addresses each. Optional — absent means the
   * Coverage judge infers the parts from the prompt alone.
   */
  readonly extractedEntities?: ExtractedEntities;
}

/**
 * Question parts the answer should cover, sourced from the upstream coordinator's
 * already-extracted signals (e.g. AC2's brain.entities + dossier.signals). Purely
 * a Coverage checklist — the judge does no extraction of its own.
 */
export interface ExtractedEntities {
  readonly intent?: string;
  readonly brand?: string;
  readonly industry?: string;
  readonly product?: string;
  readonly concepts?: readonly string[];
  /** Onion discovery signals (stack/scale/role/pain/industry/product/feature/solution). */
  readonly signals?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Judge output (what an LLM judge returns, parsed)
// ---------------------------------------------------------------------------

export interface DimensionScore {
  /** Matches RubricDimension.id. */
  readonly dimensionId: string;
  /** Raw 1-10 (clamped to rubric min/max on parse). */
  readonly score: number;
  /** One-line justification for this dimension's score. */
  readonly rationale: string;
}

/**
 * A grounding violation flagged by a judge: a factual claim in the artifact that
 * is NOT supported by any provided source. Only the Skeptic's VERIFIED
 * violations trip the hard gate (see config), but any judge may report them.
 */
export interface GroundingViolation {
  /** The unsupported claim, quoted or paraphrased from the artifact. */
  readonly claim: string;
  /** Why no source supports it. */
  readonly reason: string;
  /**
   * The judge's certainty the violation is real, 0-1. Used to decide whether
   * a flag is "verified" (>= verifiedConfidence in the gate config). NOTE: named
   * `certainty` (not `confidence`) so it never collides with the answer-level
   * "Confidence" composite score in the UI/API.
   */
  readonly certainty: number;
  /**
   * The NATURE of the flag (2026-06-19):
   *   - "contradicted": the sources state otherwise, or the claim is clearly
   *     fabricated/invented → a real hallucination. ONLY these trip the hard gate.
   *   - "unverifiable": the claim simply isn't found in the (possibly thin/partial)
   *     sources — no evidence either way. Lowers the grounding dimension score but
   *     does NOT cap the answer (this is what made thin-source live runs all read 3.0).
   * Absent → treated as "contradicted" (safe default: keep gating un-labelled flags).
   */
  readonly kind?: "contradicted" | "unverifiable";
  /**
   * TRACEABLE EXCERPT (Phase 2, spike plan §1c). Id of the SOURCE whose text
   * contradicts the claim. "" for a pure fabrication that contradicts no
   * specific source, or for kind==="unverifiable" (nothing to quote for an
   * absence). Optional for back-compat with pre-Phase-2 fixtures.
   */
  readonly sourceId?: string;
  /**
   * VERBATIM excerpt from that source that does the contradicting. "" when the
   * flag is a pure fabrication or unverifiable. Optional for back-compat.
   */
  readonly excerpt?: string;
  /**
   * Set by the deterministic post-validator (excerptCheck.ts), NEVER the LLM:
   * true iff a non-empty `excerpt` actually appears (normalized-whitespace
   * substring match) in source `sourceId`'s text. Absent/empty excerpt → false.
   * Optional so frozen pre-Phase-2 fixtures (no excerpts) parse unchanged.
   */
  readonly excerptVerified?: boolean;
}

/** One judge's complete assessment of one artifact in one round. */
export interface Judgment {
  readonly judgeId: string;
  readonly temperament: Temperament;
  readonly dimensionScores: readonly DimensionScore[];
  readonly groundingViolations: readonly GroundingViolation[];
  /** Overall free-text verdict from this judge. */
  readonly summary: string;
  /**
   * Weighted aggregate of this judge's own dimension scores, normalised to the
   * rubric's [min,max] scale. Computed by aggregation, not by the LLM.
   */
  readonly weightedScore: number;
}

// ---------------------------------------------------------------------------
// Hard gates
// ---------------------------------------------------------------------------

export interface HardGateConfig {
  /**
   * If true, a corroborated grounding violation (see verifiedConfidence +
   * corroborationThreshold) caps the final score at `cap`, regardless of prose.
   */
  readonly groundingGateEnabled: boolean;
  /**
   * WHAT IS ALLOWED TO CAP THE SCORE (decided 2026-07-28).
   *
   * - "deterministic" — only `detGround.ts`'s verbatim search can cap. LLM
   *   findings are computed and surfaced as ADVISORY output but never move the
   *   number. This is the served configuration.
   * - "llm" — the Phase 2 cross-judge corroboration gate caps (the historical
   *   behaviour, kept for regression tests and for callers scoring artifacts
   *   where hard-term search does not apply).
   *
   * Why deterministic is the default: measured on identical input with no code
   * change, the LLM gate returned {3.00, 8.89} — sd 2.88 — and multi-round
   * voting did not fix it, because the bias is systematic rather than random.
   * The deterministic check scored precision 1.00 with zero variance over the
   * same 36-case ground-truth set. A reproducible under-detector is worth more
   * on a customer-facing surface than a non-reproducible over-detector.
   *
   * FALLBACK: "deterministic" needs a `DeterministicGrounding` passed into the
   * gate. When a caller omits it (every pre-2026-07-28 call site, and the pure
   * unit tests), the gate falls back to the LLM path and reports which one
   * actually decided in `GateOutcome.mode` — so a silent fallback is always
   * visible in the outcome rather than inferred.
   */
  readonly groundingMode?: "deterministic" | "llm";
  /** Final score ceiling (on a 0-10 scale) when the grounding gate trips. */
  readonly cap: number;
  /** Minimum confidence for a violation to count as "verified". Default 0.7. */
  readonly verifiedConfidence: number;
  /**
   * Whether an "unverifiable" violation — a claim absent from the corpus rather
   * than contradicting it — can cap the score.
   *
   * Was permanently false until 2026-07-28. That was the right call while the
   * capture harness truncated every source to 3,500 chars (~16% of the median
   * doc): with most of the evidence missing, supported claims constantly looked
   * unverifiable, so gating on it would have capped nearly everything. The
   * truncation is fixed, sources are now complete, and "unverifiable" means
   * something much closer to "genuinely not in the corpus".
   *
   * This matters because it is the actual hallucination shape. Invented content
   * rarely contradicts the docs; it asserts something the docs never mention.
   * Verified live: an answer claiming ActionButton suits "toolbars" — a word in
   * none of its 11 cited sources — contradicts nothing and so could not gate.
   *
   * Corroboration (2 of 3 judges) still applies, which is the real guard against
   * the solo-Skeptic 9/9/9→3.10 over-gating bug.
   */
  readonly gateOnUnverifiable?: boolean;
  /**
   * Confidence bar for an "unverifiable" flag specifically. Held higher than
   * `verifiedConfidence` because absence is weaker evidence than contradiction —
   * a judge can fail to find support that exists. Defaults to verifiedConfidence.
   */
  readonly unverifiableConfidence?: number;
  /**
   * Distinct judges that must independently flag the SAME claim cluster to
   * cap the score (Phase 2 corroboration gate). Locked at 2 (of 3) — the fix
   * for the solo-Skeptic 9/9/9→3.10 bug: one persona alone can no longer cap.
   */
  readonly corroborationThreshold: number;
  /**
   * claimSimilarity cutoff (0-1) for two flags to be treated as "the same
   * claim" when clustering across judges. Locked at 0.5.
   */
  readonly claimSimThreshold: number;
  /**
   * Kept for back-compat with the OLD single-round evaluateHardGate; the new
   * corroboration gate ignores temperament — ANY 2 of the 3 judges corroborate.
   */
  readonly gatingTemperaments: readonly Temperament[];
}

/**
 * A cluster of gate-eligible violations across judges that were judged the
 * "same claim" by claimSimilarity. Phase 2 corroboration gate — see gate.ts.
 */
export interface CorroboratedCluster {
  /** Representative claim (the first flag that seeded the cluster). */
  readonly representativeClaim: string;
  /** Distinct judgeIds that flagged this cluster (length >= 2 when corroborated). */
  readonly judgeIds: readonly string[];
  /** Highest certainty any judge assigned in this cluster. */
  readonly maxCertainty: number;
  /**
   * The gate-eligible violations in this cluster, one per contributing judge
   * (carries sourceId/excerpt/excerptVerified through for the UI).
   */
  readonly violations: readonly GroundingViolation[];
}

export interface GateOutcome {
  readonly tripped: boolean;
  /**
   * Which mechanism ACTUALLY decided `tripped` for this outcome — not what was
   * configured. Reads "llm" when `groundingMode` was "deterministic" but no
   * `DeterministicGrounding` was supplied, so the fallback is never silent.
   */
  readonly mode: "deterministic" | "llm";
  /**
   * The reproducible verbatim-search verdict, when one was supplied. Present
   * even in "llm" mode if the caller computed it — it is always worth showing.
   */
  readonly deterministic?: DeterministicGrounding;
  /**
   * LLM clusters that reached the corroboration threshold but did NOT cap,
   * because `groundingMode` is "deterministic". Advisory: display them, do not
   * score them. Empty in "llm" mode (there they cap, and appear in
   * `corroboratedClusters`).
   */
  readonly advisoryClusters?: readonly CorroboratedCluster[];
  /** The capped value applied (only meaningful when tripped). */
  readonly cap: number;
  /**
   * @deprecated Phase 1 field, kept only for the OLD evaluateHardGate return
   * shape. The Phase 2 corroboration gate populates `corroboratedClusters`
   * instead; this stays empty on the new path.
   */
  readonly triggeringViolations: readonly GroundingViolation[];
  /**
   * Clusters flagged by >= corroborationThreshold distinct judges. Non-empty
   * iff `tripped` is true (Phase 2 corroboration gate).
   */
  readonly corroboratedClusters: readonly CorroboratedCluster[];
  /**
   * Gate-eligible clusters flagged by exactly ONE judge — shown as a visible
   * "borderline, watch this" note; these NEVER cap the score.
   */
  readonly soloFlags: readonly CorroboratedCluster[];
  /** True iff `soloFlags` is non-empty and `!tripped` — the UI shows a borderline banner. */
  readonly borderline: boolean;
  readonly explanation: string;
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

export type ConsensusRule = "mean" | "median" | "trimmed-skeptic-weighted";

export interface SynthesisConfig {
  readonly rule: ConsensusRule;
  /**
   * For "trimmed-skeptic-weighted": extra multiplier on the Skeptic's
   * pre-synthesis weighted score. Default 1.5 (the Skeptic carries more weight
   * because false confidence is more costly than excess caution).
   */
  readonly skepticWeight?: number;
}

/** Final reconciled result for one artifact in one round. */
export interface SynthesisResult {
  /** Final 0-10 score after consensus math AND hard gates. */
  readonly finalScore: number;
  /** The pre-gate consensus score, for transparency. */
  readonly preGateScore: number;
  readonly gate: GateOutcome;
  /** Spread across judges' weighted scores (max - min), a variance signal. */
  readonly panelSpread: number;
  /** Written rationale (LLM-authored when a synthesizer fn is provided). */
  readonly rationale: string;
}

// ---------------------------------------------------------------------------
// Panel + multi-round results
// ---------------------------------------------------------------------------

export interface JudgePanelResult {
  readonly artifactType: string;
  readonly round: number;
  readonly judgments: readonly Judgment[];
  readonly synthesis: SynthesisResult;
}

export interface MultiRoundStats {
  readonly rounds: number;
  readonly finalScores: readonly number[];
  readonly meanFinalScore: number;
  /** Population standard deviation of finalScores across rounds. */
  readonly stdDevFinalScore: number;
  /** Max - min of finalScores. A high value means the judge is unstable. */
  readonly range: number;
  /** True if any round tripped the hard gate. */
  readonly anyGateTripped: boolean;
}

/**
 * A STABLE multi-round aggregate. The per-judge prose scores are reproducible
 * at low temperature; the only cross-round noise comes from the binary hard gate
 * flickering on borderline answers. This aggregate fixes that by (a) averaging
 * the stable PRE-gate consensus across rounds and (b) deciding the gate by a VOTE
 * across rounds — a violation must REPRODUCE in >= voteThreshold of rounds to cap
 * the score, so a one-off stochastic flag can no longer swing the verdict.
 */
export interface RoundAggregate {
  readonly rounds: number;
  /** Pre-gate consensus score for each round (0-10). */
  readonly perRoundPreGate: readonly number[];
  /** Mean of the per-round pre-gate scores — the stable quality metric. */
  readonly meanPreGateScore: number;
  /** Population stdDev of the per-round pre-gate scores — the reproducibility signal. */
  readonly stdDevPreGateScore: number;
  /** Fraction of rounds whose hard gate tripped, 0-1. */
  /**
   * @deprecated Phase 1 per-round-recurrence field. Under the Phase 2
   * cross-judge corroboration gate this is meaningless (the gate decision is
   * pooled across rounds, not voted per round) — set to `gateTripped ? 1 : 0`.
   * Removing it is a Phase 6 wire change.
   */
  readonly gateTripFraction: number;
  /** True iff the pooled cross-judge corroboration gate tripped. */
  readonly gateTripped: boolean;
  /**
   * True iff there is SOME violation evidence (a solo-judge flag) but it is NOT
   * corroborated by a 2nd distinct judge — a genuinely ambiguous grounding
   * signal. Borderline answers are NOT auto-capped; they are surfaced for
   * review. Per the "corroboration + flag" policy.
   */
  readonly borderline: boolean;
  /** Clusters flagged by >= corroborationThreshold distinct judges, pooled across rounds. */
  readonly corroboratedClusters?: readonly CorroboratedCluster[];
  /** Gate-eligible clusters flagged by exactly one distinct judge, pooled across rounds. */
  readonly soloFlags?: readonly CorroboratedCluster[];
  /**
   * Corroborated LLM clusters that did NOT cap because the gate ran in
   * "deterministic" mode. Advisory — shown, never scored.
   */
  readonly advisoryClusters?: readonly CorroboratedCluster[];
  /** The reproducible verbatim-search verdict, when the caller supplied one. */
  readonly deterministic?: DeterministicGrounding;
  /** Which mechanism actually decided `gateTripped`. */
  readonly gateMode?: "deterministic" | "llm";
  /** meanPreGateScore, capped to the gate cap iff gateTripped. */
  readonly finalScore: number;
  /**
   * Mean raw (1-10) score per rubric dimension, averaged across all judges and
   * all rounds. Keyed by dimensionId; omits dimensions not scored (e.g.
   * engagement on a one-shot answer). Feeds the autocorrect loop's
   * weakest-dimension diagnosis AND the UI's per-dimension bars.
   */
  readonly dimensionMeans: Readonly<Record<string, number>>;
  /**
   * Each judge's COMPOSITE (its weighted-mean score across the rubric
   * dimensions, on the 0-10 final scale), averaged across all rounds. The final
   * pre-gate score is the mean of these composites. Surfaced for the UI's
   * per-judge breakdown and for transparency.
   */
  readonly judgeComposites: readonly JudgeComposite[];
}

/** One judge's round-averaged composite score, on the 0-10 final scale. */
export interface JudgeComposite {
  readonly judgeId: string;
  readonly temperament: Temperament;
  /** Round-averaged composite on 0-10. */
  readonly composite: number;
}

export interface MultiRoundResult {
  readonly artifactType: string;
  readonly perRound: readonly JudgePanelResult[];
  readonly stats: MultiRoundStats;
  /** Stable voted-gate aggregate over the rounds (the score the harness uses). */
  readonly aggregate: RoundAggregate;
}

// ---------------------------------------------------------------------------
// Top-level judge configuration
// ---------------------------------------------------------------------------

export interface JudgeConfig {
  readonly rubric: Rubric;
  readonly judges: readonly JudgeProfile[];
  readonly gate: HardGateConfig;
  readonly synthesis: SynthesisConfig;
  /**
   * Fraction of rounds in which a verified gating violation must reproduce for
   * the multi-round voted gate to trip (see aggregateRounds). Defaults to
   * DEFAULT_GATE_VOTE_THRESHOLD (0.5) when omitted.
   */
  readonly roundVoteThreshold?: number;
}
