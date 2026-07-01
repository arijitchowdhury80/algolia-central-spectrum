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

// ---------------------------------------------------------------------------
// Provider abstraction (no SDK is imported anywhere in this package)
// ---------------------------------------------------------------------------

export interface LlmCompleteOptions {
  /** Sampling temperature, if the provider supports it. */
  readonly temperature?: number;
  /** Hard cap on output tokens, if the provider supports it. */
  readonly maxTokens?: number;
  /** Optional system prompt, separated from the user prompt. */
  readonly system?: string;
  /** Free-form label used only for logging/tracing by the caller. */
  readonly tag?: string;
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
   * If true, a VERIFIED grounding violation (see verifiedConfidence +
   * gatingTemperaments) caps the final score at `cap`, regardless of prose.
   */
  readonly groundingGateEnabled: boolean;
  /** Final score ceiling (on a 0-10 scale) when the grounding gate trips. */
  readonly cap: number;
  /** Minimum confidence for a violation to count as "verified". Default 0.7. */
  readonly verifiedConfidence: number;
  /**
   * Which temperaments' violations can trip the gate. Default ["skeptic"] — the
   * Skeptic is the designated hallucination hunter.
   */
  readonly gatingTemperaments: readonly Temperament[];
}

export interface GateOutcome {
  readonly tripped: boolean;
  /** The capped value applied (only meaningful when tripped). */
  readonly cap: number;
  /** The violations that caused the trip. */
  readonly triggeringViolations: readonly GroundingViolation[];
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
  readonly gateTripFraction: number;
  /** True iff gateTripFraction >= tripThreshold (a reproducible violation). */
  readonly gateTripped: boolean;
  /**
   * True iff there is SOME violation evidence (fraction > cleanThreshold) but it
   * is NOT a reproducible supermajority — a genuinely ambiguous grounding signal.
   * Borderline answers are NOT auto-capped (we don't cap on a coin flip); they
   * are surfaced for review. Per Arijit's "supermajority + flag" policy.
   */
  readonly borderline: boolean;
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
