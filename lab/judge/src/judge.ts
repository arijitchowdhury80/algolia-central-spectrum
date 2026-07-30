import { weightedAggregate } from "./aggregate.js";
import { deterministicGrounding } from "./detGround.js";
import { verifyExcerpts } from "./excerptCheck.js";
import { parseJudgeOutput } from "./parse.js";
import { buildJudgePrompt, buildSynthesisPrompt } from "./prompt.js";
import { markSince, spanSync } from "./trace.js";
import {
  DEFAULT_GATE_CLEAN_THRESHOLD,
  DEFAULT_GATE_VOTE_THRESHOLD,
  aggregateRounds,
  multiRoundStats,
  synthesize,
} from "./synthesis.js";
import type {
  Artifact,
  JudgeConfig,
  JudgePanelResult,
  Judgment,
  LlmComplete,
  MultiRoundResult,
} from "./types.js";

/**
 * Runs the full blind panel + synthesis for ONE artifact in ONE round.
 *
 * This is the only function that touches the injected LLM. All scoring math is
 * delegated to the pure modules (aggregate / gate / synthesis), so the logic is
 * unit-tested without any network by mocking `llm`.
 *
 * Flow: each judge gets a blinded prompt -> LLM -> parse -> weighted aggregate
 * -> panel synthesis (consensus + hard gate) -> optional LLM-authored rationale.
 */
/** Re-ask a judge this many extra times if its output won't parse as JSON. */
const MAX_PARSE_RETRIES = 2;

export async function judgeArtifact(
  artifact: Artifact,
  cfg: JudgeConfig,
  llm: LlmComplete,
  round = 1,
  authorRationale = true,
): Promise<JudgePanelResult> {
  // Run judges in parallel — they are independent and blind to one another.
  const rawJudgments: Judgment[] = await Promise.all(
    cfg.judges.map(async (judge) => {
      const prompt = buildJudgePrompt(judge, artifact, cfg.rubric);
      // Retry on unparseable output: strong models occasionally emit a stray
      // token producing invalid JSON (observed with gemini-2.5-pro). A single
      // glitch must not fail the judgment — re-ask up to MAX_PARSE_RETRIES times.
      let parsed: ReturnType<typeof parseJudgeOutput> | undefined;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        // Traced per ATTEMPT, not per judge: a silent re-ask doubles this
        // judge's wall-clock, and a total that hides retries reads as "the
        // model is slow" when the truth is "we called it twice".
        const startedAt = Date.now();
        const raw = await llm(prompt, {
          temperature: judge.temperature,
          tag: `judge:${judge.id}:round${round}`,
        });
        markSince(`llm:judge:${judge.id}:round${round}:attempt${attempt + 1}`, startedAt, {
          promptChars: prompt.length,
          outputChars: raw.length,
        });
        try {
          parsed = parseJudgeOutput(raw, cfg.rubric);
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!parsed) {
        throw new Error(
          `Judge ${judge.id} produced unparseable output after ${MAX_PARSE_RETRIES + 1} attempts: ${(lastErr as Error)?.message ?? lastErr}`,
        );
      }
      const weightedScore = weightedAggregate(
        parsed.dimensionScores,
        cfg.rubric,
        artifact,
      );
      return {
        judgeId: judge.id,
        temperament: judge.temperament,
        dimensionScores: parsed.dimensionScores,
        groundingViolations: parsed.groundingViolations,
        summary: parsed.summary,
        weightedScore,
      };
    }),
  );

  // Deterministic post-validation (excerptCheck.ts, no LLM): sets
  // excerptVerified against the artifact's own Source texts, BEFORE the gate
  // sees the violations. The one impure orchestrator wires this in; the pure
  // gate/synthesis functions stay pure.
  const judgments = spanSync(
    "verifyExcerpts",
    () => verifyExcerpts(rawJudgments, artifact.sources),
    () => ({ sources: artifact.sources.length }),
  );

  // Deterministic grounding (detGround.ts, no LLM): a verbatim search for the
  // terms that cannot be paraphrased. Under the default config this — not the
  // panel — decides whether the score is capped, which is what makes the
  // served verdict reproducible. Computed here, in the one impure
  // orchestrator, so the gate/synthesis functions stay pure.
  const det = spanSync(
    "detGround",
    () => deterministicGrounding(artifact.content, artifact.sources),
    (d) => ({ checked: d.checked, sourceChars: artifact.sources.reduce((n, s) => n + s.text.length, 0) }),
  );

  // Pure synthesis first (computes the numeric final score + gate outcome).
  const preliminary = synthesize(
    judgments,
    cfg.rubric,
    cfg.synthesis,
    cfg.gate,
    undefined,
    det,
  );

  // Then optionally ask the Chief Synthesizer to author the rationale around that
  // number. Skipped in multi-round (the rationale is authored ONCE at the end of
  // all rounds) so we don't pay N synthesizer calls per artifact.
  let rationale = preliminary.gate.explanation;
  if (authorRationale) {
    const synthPrompt = buildSynthesisPrompt(
      artifact,
      judgments.map((j) => ({
        judgeId: j.judgeId,
        weightedScore: j.weightedScore,
        summary: j.summary,
        violations: j.groundingViolations.length,
      })),
      preliminary.finalScore,
      preliminary.gate.tripped,
    );
    const synthStartedAt = Date.now();
    rationale = (await llm(synthPrompt, { tag: `synthesizer:round${round}` })).trim();
    markSince(`llm:synthesizer:round${round}`, synthStartedAt, {
      promptChars: synthPrompt.length,
      outputChars: rationale.length,
    });
  }

  const synthesisResult = { ...preliminary, rationale };

  return {
    artifactType: artifact.type,
    round,
    judgments,
    synthesis: synthesisResult,
  };
}

/**
 * Runs N rounds of the panel for one artifact and tracks variance across rounds.
 * Use this to detect an unstable / gameable judge: a high stdDev or range across
 * rounds means the panel is not reproducible.
 */
export async function judgeArtifactMultiRound(
  artifact: Artifact,
  cfg: JudgeConfig,
  llm: LlmComplete,
  rounds: number,
): Promise<MultiRoundResult> {
  const perRound: JudgePanelResult[] = [];
  for (let r = 1; r <= rounds; r++) {
    // authorRationale=false: skip the per-round synthesizer LLM call.
    perRound.push(await judgeArtifact(artifact, cfg, llm, r, false));
  }

  // STABLE verdict: average the reproducible pre-gate consensus + vote the gate
  // across rounds. This is the score the harness/loop consumes.
  const aggregate = aggregateRounds(
    perRound.map((p) => p.judgments),
    cfg.rubric,
    cfg.synthesis,
    cfg.gate,
    cfg.roundVoteThreshold ?? DEFAULT_GATE_VOTE_THRESHOLD,
    DEFAULT_GATE_CLEAN_THRESHOLD,
    deterministicGrounding(artifact.content, artifact.sources),
  );

  // Author ONE rationale for the whole multi-round verdict (uses round-1 judges
  // as the representative panel; the number reflects the voted aggregate).
  const synthPrompt = buildSynthesisPrompt(
    artifact,
    perRound[0].judgments.map((j) => ({
      judgeId: j.judgeId,
      weightedScore: j.weightedScore,
      summary: j.summary,
      violations: j.groundingViolations.length,
    })),
    aggregate.finalScore,
    aggregate.gateTripped,
  );
  const synthStartedAt = Date.now();
  const rationale = (await llm(synthPrompt, { tag: "synthesizer:multiround" })).trim();
  markSince("llm:synthesizer:multiround", synthStartedAt, {
    promptChars: synthPrompt.length,
    outputChars: rationale.length,
  });
  // Attach the authored rationale to round 1 for transparency.
  perRound[0] = {
    ...perRound[0],
    synthesis: { ...perRound[0].synthesis, rationale },
  };

  const finalScores = perRound.map((p) => p.synthesis.finalScore);
  const anyGateTripped = perRound.some((p) => p.synthesis.gate.tripped);
  return {
    artifactType: artifact.type,
    perRound,
    stats: multiRoundStats(finalScores, anyGateTripped),
    aggregate,
  };
}
