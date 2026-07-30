/**
 * liveJudge — judge a SINGLE request's displayed answers, on demand, for a
 * chat UI's Analysis panel.
 *
 * PORTED VERBATIM from AC2 lab/server/src/judge/liveJudge.ts (self-contained,
 * only imports @lab/judge). The cross-panel `multiLift` delta (P4-P3) is kept
 * as-is: it is a generic "panel P4 minus panel P3" computation, harmless when
 * the caller doesn't send those panelIds (computeDeltas simply omits `deltas`
 * from the result). ACS's 2-agent panel (ACS-generic-neural /
 * ACS-technical-neural) can pass any panelId it likes.
 *
 * Live judging is INDICATIVE (thinner sources + fewer rounds for latency).
 * The scoring fn is INJECTED so the orchestration is unit-testable without a
 * network; judgeHandler.ts binds the default (provider-resolved Gemini/OpenAI
 * llm via activeJudgeLlm.ts).
 */
import {
  judgeArtifactMultiRound,
  ALGOLIA_ANSWER_RUBRIC,
  DEFAULT_JUDGE_CONFIG,
  type Artifact,
  type CorroboratedCluster,
  type LlmComplete,
  type MultiRoundResult,
  type RoundAggregate,
  type Temperament,
  type UnsupportedTerm,
} from "@lab/judge";

/** A source the UI captured for an answer (thinner than a full-text batch source). */
export interface LiveSource {
  id?: string;
  title?: string;
  url?: string;
  /** Substantive body for the grounding check; falls back to title. */
  text?: string;
}

/** One panel's displayed answer to be judged. */
export interface LivePanelInput {
  panelId: string;
  label?: string;
  answer: string;
  sources: LiveSource[];
  /**
   * The panel's GENERATED follow-up question (the MULTI-TURN test). When
   * present, the judge scores its quality (`followUpQuality`) as a separate
   * comparable signal — NOT folded into the composite.
   */
  generatedFollowUp?: string;
}

export interface LiveJudgeRequest {
  question: string;
  /** Second turn of a two-way exchange; enables the engagement dimension. */
  followUp?: string;
  /** Out-of-scope question where a clean refusal is the CORRECT answer. */
  isRefusalTest?: boolean;
  /** Rounds for the voted gate; defaults applied by the caller. */
  rounds?: number;
  panels: LivePanelInput[];
}

/** One scored rubric dimension, round+judge averaged, for the UI's per-dim bars. */
export interface VerdictDimension {
  id: string;
  label: string;
  /** Mean raw score on the rubric's 1-10 scale. */
  score: number;
}

/**
 * A claim flagged as unsupported by the sources — Phase 2 rebuild: ANY judge
 * (not just the Skeptic) can flag; what caps the score is CORROBORATION
 * (>= 2 distinct judges on the same claim cluster), not temperament. Carries
 * the traceable-excerpt fields (spec §1c) so the UI can show "here's the
 * source text that contradicts this" instead of an opaque accusation.
 */
export interface VerdictViolation {
  /** The unsupported claim, quoted/paraphrased from the answer. */
  claim: string;
  /** Why no provided source backs it. */
  reason: string;
  /** Highest certainty (0-1) any judge in this claim's cluster assigned. */
  certainty: number;
  /** Distinct judges that flagged this claim (>= 2 means corroborated/capping). */
  judgeIds?: string[];
  /** Id of the source whose text contradicts the claim; "" for pure fabrication. */
  sourceId?: string;
  /** Verbatim excerpt from that source doing the contradicting. */
  excerpt?: string;
  /** Set by the deterministic post-validator — true iff `excerpt` actually appears in `sourceId`'s text. */
  excerptVerified?: boolean;
}

/** One gate-eligible claim cluster (spec §3.3 `CorroboratedCluster`), wire-shaped
 *  for the UI: which judges flagged it, the highest certainty, and each
 *  contributing flag's traceable-excerpt fields. */
export interface VerdictCluster {
  representativeClaim: string;
  judgeIds: string[];
  maxCertainty: number;
  violations: {
    claim: string;
    reason: string;
    certainty: number;
    sourceId?: string;
    excerpt?: string;
    excerptVerified?: boolean;
  }[];
}

/**
 * The single scored dimension (Phase 2 rebuild, spec §7 migration): grounding
 * stopped being a scored number and became purely the corroboration gate
 * (see `corroboratedClusters`/`soloFlags`/`gateTripped`/`borderline` below).
 * `Record<string, number>`-typed readers (e.g. the web client's tolerant
 * `JudgeDims`) still render this fine — only the key changed.
 */
export interface VerdictDims {
  usefulness: number;
}

export interface LiveJudgeVerdict {
  panelId: string;
  /** One per temperament: round-averaged composite (0-10) + that judge's round-0 note. */
  judges: { role: Temperament; score: number; note: string }[];
  /** Alias of `judges`, named `perJudge` to match the wire contract. */
  perJudge: { role: Temperament; score: number; note: string }[];
  /** The rubric breakdown — one entry, `usefulness`, under the Phase 2 rebuild. */
  dimensions: VerdictDimension[];
  /** Named dim breakdown for the cross-panel contract — `{ usefulness }`. */
  dims: VerdictDims;
  /** Claim clusters flagged unsupported — the "why" behind a gate trip/borderline, corroborated + solo combined. */
  violations: VerdictViolation[];
  /** Alias of `violations`, named `flaggedClaims` to match the wire contract. */
  flaggedClaims: VerdictViolation[];
  /** Final 0-10 after consensus + corroboration gate (aggregate.finalScore) = the composite. */
  synthesizedScore: number;
  /** The composite (alias of synthesizedScore) — gate x mean(usefulness). */
  composite: number;
  /** Stable pre-gate consensus (aggregate.meanPreGateScore). */
  preGateScore: number;
  gateTripped: boolean;
  /** True iff a solo (uncorroborated) flag exists and the gate did NOT trip — shown as a "watch this" banner, never caps the score. */
  borderline: boolean;
  /** Claim clusters flagged by >= corroborationThreshold (2) distinct judges — these are what capped the score when `gateTripped`. */
  corroboratedClusters: VerdictCluster[];
  /** Claim clusters flagged by exactly ONE judge — surfaced for visibility, never cap. */
  soloFlags: VerdictCluster[];
  /**
   * THE GROUNDING ANSWER THE UI SHOWS (2026-07-28). Reproducible: a pure
   * verbatim search for the terms that cannot be paraphrased (code identifiers,
   * scaled numbers, CamelCase API names). True iff every one was located in the
   * sources. This — not `composite` — is what the Confidence chip displays,
   * because it is the only signal here that has been validated and that returns
   * the same answer twice.
   */
  grounded: boolean;
  /** The hard terms found in NO source. Empty iff `grounded`. */
  unsupportedTerms: UnsupportedTerm[];
  /** How many hard terms were searched for. 0 = pure prose, nothing to verify. */
  termsChecked: number;
  /** Which mechanism actually decided the cap: "deterministic" on the served path. */
  groundingMode: "deterministic" | "llm";
  /**
   * Corroborated LLM clusters that did NOT cap the score because the gate ran
   * in deterministic mode. ADVISORY: display them, do not score them. They
   * carry real recall the deterministic check lacks (`unsupported_add` 8/8 vs
   * 0/8), which is why they are surfaced rather than dropped.
   */
  advisoryClusters: VerdictCluster[];
  /**
   * Quality of the panel's GENERATED follow-up question (0-10), scored ONLY
   * when a follow-up is present (the MULTI-TURN test). NOT folded into the
   * composite.
   */
  followUpQuality?: number;
  /** Chief-synthesizer narrative. */
  rationale: string;
  /** Set if this panel could not be judged; other panels are unaffected. */
  error?: string;
}

/**
 * Cross-panel deltas — computed as panel "P4" minus panel "P3" when both are
 * present. Harmless no-op for callers (like ACS) that use different panelIds:
 * `deltas` is simply omitted from the result.
 */
export interface CrossPanelDeltas {
  multiLift?: number;
}

export interface LiveJudgeResult {
  rounds: number;
  panels: LiveJudgeVerdict[];
  /** Present only when panels "P3" and "P4" were both judged together. */
  deltas?: CrossPanelDeltas;
  /**
   * EXACT LLM token usage across every call made judging this request
   * (../usage.ts's `UsageSummary`). Typed loosely here (liveJudge.ts stays
   * decoupled from ../usage.ts) — judgeHandler.ts attaches it after
   * `judgeLive` returns; a caller predating this field simply won't see it.
   * Cost tracking §6.
   */
  usage?: {
    calls: readonly { tag?: string; model: string; inputTokens: number; outputTokens: number }[];
    totalInputTokens: number;
    totalOutputTokens: number;
    estimatedCostUsd: number;
    hasUnpricedCalls: boolean;
  };
}

/** Scores one artifact over N rounds. Injected for testing; default uses the LLM. */
export type ArtifactScorer = (
  artifact: Artifact,
  rounds: number,
) => Promise<MultiRoundResult>;

/**
 * Scores the QUALITY of a generated follow-up question (0-10) — the
 * MULTI-TURN head-to-head signal. Injected for testing; the default is
 * LLM-backed (`makeFollowUpScorer`). On-topic + logical + advances the
 * conversation = high.
 */
export type FollowUpScorer = (
  question: string,
  answer: string,
  followUp: string,
) => Promise<number>;

const FOLLOWUP_JUDGE_SYSTEM = `You score the QUALITY of a single GENERATED follow-up question that an answer
assistant proposed after answering. You are NOT answering anything; you only rate the follow-up.

Score 0-10 on three things, then give ONE integer:
- ON-TOPIC: is it strictly about the same domain as the original question? (off-topic = very low)
- LOGICAL: does it make sense given the original question and the answer given? (a non-sequitur = low)
- ADVANCES: does it move the conversation forward — clarifying an ambiguous opener, or deepening a clear one — rather than restating what was already covered?

A great follow-up is on-topic, logical, and genuinely advances the conversation -> 9-10.
A weak/generic/off-topic/repetitive one -> 0-4.

Return STRICT JSON only: { "score": <integer 0-10> }`;

/** Build the default LLM-backed follow-up-quality scorer. */
export function makeFollowUpScorer(llm: LlmComplete): FollowUpScorer {
  return async (question, answer, followUp): Promise<number> => {
    const out = await llm(
      `Original question: ${question}\nAnswer given (context): ${answer}\nGenerated follow-up to score: ${followUp}`,
      { system: FOLLOWUP_JUDGE_SYSTEM, temperature: 0, tag: "followup-quality" },
    );
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start === -1 || end === -1) return 0;
    try {
      const j = JSON.parse(out.slice(start, end + 1)) as { score?: number };
      const s = Number(j.score);
      return Number.isFinite(s) ? Math.max(0, Math.min(10, s)) : 0;
    } catch {
      return 0;
    }
  };
}

/**
 * Compute the cross-panel deltas from a set of verdicts (keyed by panelId).
 * Computes multiLift (P4 - P3) when both panels are present + error-free. Pure.
 */
export function computeDeltas(verdicts: LiveJudgeVerdict[]): CrossPanelDeltas {
  const by = new Map(verdicts.filter((v) => !v.error).map((v) => [v.panelId, v.composite]));
  const sub = (a: string, b: string): number | undefined => {
    const x = by.get(a);
    const y = by.get(b);
    return x === undefined || y === undefined ? undefined : x - y;
  };
  const deltas: CrossPanelDeltas = {};
  const mlN = sub("P4", "P3");
  if (mlN !== undefined) {
    deltas.multiLift = mlN;
  }
  return deltas;
}

/**
 * Default number of live rounds. The live panel is INDICATIVE, so it runs a
 * SINGLE round for latency — the multi-round voted gate / zero-flicker
 * guarantee matters for an authoritative batch verdict, not the on-screen
 * spinner.
 */
export const DEFAULT_LIVE_ROUNDS = 1;

/** Build a blind judge Artifact from one requested panel. Pure. */
export function buildLiveArtifact(
  req: LiveJudgeRequest,
  panel: LivePanelInput,
): Artifact {
  const prompt = req.followUp
    ? `${req.question}\n(follow-up) ${req.followUp}`
    : req.question;

  const sources = panel.sources.map((s, i) => ({
    id: s.id ?? `S${i + 1}`,
    text: s.text?.trim() || s.title?.trim() || "",
    ...(s.title ? { label: s.title } : s.url ? { label: s.url } : {}),
  }));

  // Engagement only applies to the two-way (multi-turn) questions.
  const notApplicableDimensions = req.followUp ? [] : ["engagement"];

  return {
    type: "algolia-answer",
    prompt,
    content: panel.answer,
    sources,
    notApplicableDimensions,
    ...(req.isRefusalTest ? { expectedBehavior: "refuse" as const } : {}),
  };
}

/** Each judge's round-averaged composite (0-10); note = its round-0 summary. */
function judgesFromRounds(
  result: MultiRoundResult,
): { role: Temperament; score: number; note: string }[] {
  const round0 = result.perRound[0]?.judgments ?? [];
  return result.aggregate.judgeComposites.map((c) => ({
    role: c.temperament,
    score: c.composite,
    note: round0.find((j) => j.temperament === c.temperament)?.summary ?? "",
  }));
}

/** Map the round-averaged dimension means to the UI's per-dimension shape, in rubric order. */
function dimensionsFromAggregate(
  result: MultiRoundResult,
): VerdictDimension[] {
  const means = result.aggregate.dimensionMeans;
  return ALGOLIA_ANSWER_RUBRIC.dimensions
    .filter((d) => means[d.id] !== undefined)
    .map((d) => ({ id: d.id, label: d.label, score: means[d.id] }));
}

/** Map one gate cluster (types.ts `CorroboratedCluster`) to the wire shape. Pure. */
function toVerdictCluster(c: CorroboratedCluster): VerdictCluster {
  return {
    representativeClaim: c.representativeClaim,
    judgeIds: [...c.judgeIds],
    maxCertainty: c.maxCertainty,
    violations: c.violations.map((v) => ({
      claim: v.claim,
      reason: v.reason,
      certainty: v.certainty,
      ...(v.sourceId !== undefined ? { sourceId: v.sourceId } : {}),
      ...(v.excerpt !== undefined ? { excerpt: v.excerpt } : {}),
      ...(v.excerptVerified !== undefined ? { excerptVerified: v.excerptVerified } : {}),
    })),
  };
}

/**
 * Flatten claim clusters (corroborated + solo) into the flat `violations`
 * list the UI iterates for "flagged claims" — one entry per cluster, using
 * its representative claim + highest certainty + (if present) the first
 * traceable excerpt among its contributing flags. Pure.
 */
function flattenClusters(clusters: readonly CorroboratedCluster[]): VerdictViolation[] {
  return clusters.map((c) => {
    const withExcerpt = c.violations.find((v) => v.excerpt) ?? c.violations[0];
    return {
      claim: c.representativeClaim,
      reason: withExcerpt?.reason ?? "",
      certainty: c.maxCertainty,
      judgeIds: [...c.judgeIds],
      ...(withExcerpt?.sourceId !== undefined ? { sourceId: withExcerpt.sourceId } : {}),
      ...(withExcerpt?.excerpt !== undefined ? { excerpt: withExcerpt.excerpt } : {}),
      ...(withExcerpt?.excerptVerified !== undefined ? { excerptVerified: withExcerpt.excerptVerified } : {}),
    };
  });
}

/**
 * Collect ALL gate-eligible flagged claims — corroborated (capping) AND solo
 * (borderline, non-capping) — highest-certainty first, so the caller can show
 * WHY the gate tripped or what it was borderline on. Phase 2 rebuild: replaces
 * the old skeptic-only filter — ANY judge can now flag, corroboration (not
 * temperament) decides what caps.
 */
function violationsFromAggregate(agg: RoundAggregate): VerdictViolation[] {
  const corroborated = flattenClusters(agg.corroboratedClusters ?? []);
  const advisory = flattenClusters(agg.advisoryClusters ?? []);
  const solo = flattenClusters(agg.soloFlags ?? []);
  // Advisory clusters MUST be included: in deterministic mode they are where
  // corroborated LLM findings land, and dropping them here would make a
  // 2-of-3-judge finding invisible to the drawer.
  return [...corroborated, ...advisory, ...solo].sort((a, b) => b.certainty - a.certainty);
}

/** Pull the single `usefulness` dim from the aggregate's dimensionMeans. Pure. */
function dimsFromAggregate(result: MultiRoundResult): VerdictDims {
  const m = result.aggregate.dimensionMeans;
  return { usefulness: m.usefulness ?? 0 };
}

/** Map a multi-round judge result to the wire verdict shape. Pure. */
export function toVerdict(
  panelId: string,
  result: MultiRoundResult,
): LiveJudgeVerdict {
  const agg = result.aggregate;
  const judges = judgesFromRounds(result);
  const violations = violationsFromAggregate(agg);
  return {
    panelId,
    judges,
    perJudge: judges,
    dimensions: dimensionsFromAggregate(result),
    dims: dimsFromAggregate(result),
    violations,
    flaggedClaims: violations,
    corroboratedClusters: (agg.corroboratedClusters ?? []).map(toVerdictCluster),
    soloFlags: (agg.soloFlags ?? []).map(toVerdictCluster),
    advisoryClusters: (agg.advisoryClusters ?? []).map(toVerdictCluster),
    // Deterministic grounding. Absent only if a caller ran the pure aggregate
    // without supplying it; then the honest report is "nothing verified" rather
    // than a cheerful default, so grounded mirrors the gate instead of assuming.
    grounded: agg.deterministic?.grounded ?? !agg.gateTripped,
    unsupportedTerms: [...(agg.deterministic?.unsupported ?? [])],
    termsChecked: agg.deterministic?.checked ?? 0,
    groundingMode: agg.gateMode ?? "llm",
    synthesizedScore: agg.finalScore,
    composite: agg.finalScore,
    preGateScore: agg.meanPreGateScore,
    gateTripped: agg.gateTripped,
    borderline: agg.borderline,
    rationale: result.perRound[0]?.synthesis.rationale ?? "",
  };
}

/**
 * Judge every requested panel's displayed answer. Panels are judged IN
 * PARALLEL (each is independent) for latency; a per-panel failure is isolated
 * into that verdict's `error` so one bad answer never fails the request.
 * `onPanel` fires as each panel's verdict resolves, enabling streamed progress
 * to the caller. The returned `panels` preserve the request order regardless
 * of finish order.
 */
export interface JudgeLiveOptions {
  /** Fires as each panel's verdict resolves (streamed progress). */
  onPanel?: (verdict: LiveJudgeVerdict) => void;
  /**
   * Scores each panel's generated follow-up (the MULTI-TURN signal). When
   * omitted, `followUpQuality` is left unset even if a follow-up is present.
   */
  followUpScorer?: FollowUpScorer;
}

export async function judgeLive(
  req: LiveJudgeRequest,
  score: ArtifactScorer,
  onPanelOrOpts?: ((verdict: LiveJudgeVerdict) => void) | JudgeLiveOptions,
): Promise<LiveJudgeResult> {
  const opts: JudgeLiveOptions =
    typeof onPanelOrOpts === "function" ? { onPanel: onPanelOrOpts } : onPanelOrOpts ?? {};
  const rounds = Math.max(1, req.rounds ?? DEFAULT_LIVE_ROUNDS);

  const panels = await Promise.all(
    req.panels.map(async (panel): Promise<LiveJudgeVerdict> => {
      let verdict: LiveJudgeVerdict;
      try {
        const artifact = buildLiveArtifact(req, panel);
        const result = await score(artifact, rounds);
        verdict = toVerdict(panel.panelId, result);
        // followUpQuality — scored ONLY when the panel generated a follow-up and a
        // scorer is provided. A separate comparable signal, NOT in the composite.
        if (panel.generatedFollowUp && opts.followUpScorer) {
          verdict.followUpQuality = await opts.followUpScorer(
            req.question,
            panel.answer,
            panel.generatedFollowUp,
          );
        }
      } catch (e) {
        verdict = {
          panelId: panel.panelId,
          judges: [],
          perJudge: [],
          dimensions: [],
          dims: { usefulness: 0 },
          violations: [],
          flaggedClaims: [],
          corroboratedClusters: [],
          soloFlags: [],
          advisoryClusters: [],
          // A failed judgement proves nothing about grounding. `grounded: false`
          // here would read as "we caught a hallucination" — the UI must render
          // this as an error state, not as a verdict.
          grounded: false,
          unsupportedTerms: [],
          termsChecked: 0,
          groundingMode: "deterministic",
          synthesizedScore: 0,
          composite: 0,
          preGateScore: 0,
          gateTripped: false,
          borderline: false,
          rationale: "",
          error: (e as Error).message,
        };
      }
      opts.onPanel?.(verdict);
      return verdict;
    }),
  );

  const deltas = computeDeltas(panels);
  return {
    rounds,
    panels,
    ...(Object.keys(deltas).length > 0 ? { deltas } : {}),
  };
}

/** Bind the real judge engine to an LLM, producing a default ArtifactScorer. */
export function makeLlmScorer(llm: LlmComplete): ArtifactScorer {
  return (artifact, rounds) =>
    judgeArtifactMultiRound(artifact, DEFAULT_JUDGE_CONFIG, llm, rounds);
}
