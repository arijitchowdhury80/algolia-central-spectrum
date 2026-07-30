import { weightedAggregate } from './aggregate.js';
import { parseJudgeOutput } from './parse.js';
import { buildJudgePrompt, buildSynthesisPrompt } from './prompt.js';
import { synthesize } from './synthesis.js';
import type {
  Artifact,
  JudgeConfig,
  JudgePanelResult,
  Judgment,
  LlmComplete,
  Temperament,
} from './types.js';

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

export interface JudgeArtifactOptions {
  round?: number;
  authorRationale?: boolean;
  /**
   * Optional per-temperament LLM seams. When a judge's temperament has an entry
   * here, THAT judge runs against this LLM instead of the default `llm` param;
   * any temperament without an entry falls back to `llm`. This enables
   * multi-model judging (e.g. Skeptic / Referee / Advocate each on their own
   * Agent Studio agent) without the engine importing any provider SDK. The
   * Chief Synthesizer call always uses the default `llm`.
   */
  llmByTemperament?: Partial<Record<Temperament, LlmComplete>>;
}

export async function judgeArtifact(
  artifact: Artifact,
  cfg: JudgeConfig,
  llm: LlmComplete,
  options: JudgeArtifactOptions = {},
): Promise<JudgePanelResult> {
  const { round = 1, authorRationale = true, llmByTemperament } = options;
  // Run judges in parallel — they are independent and blind to one another.
  const judgments: Judgment[] = await Promise.all(
    cfg.judges.map(async (judge) => {
      const prompt = buildJudgePrompt(judge, artifact, cfg.rubric);
      // Route this judge to its temperament-specific LLM seam when one is
      // supplied (multi-model judging); otherwise use the default `llm`.
      const judgeLlm = llmByTemperament?.[judge.temperament] ?? llm;
      // Retry on unparseable output: strong models occasionally emit a stray
      // token producing invalid JSON (observed with gemini-2.5-pro). A single
      // glitch must not fail the judgment — re-ask up to MAX_PARSE_RETRIES times.
      let parsed: ReturnType<typeof parseJudgeOutput> | undefined;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        const raw = await judgeLlm(prompt, {
          temperature: judge.temperature,
          tag: `judge:${judge.id}:round${round}`,
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
      const weightedScore = weightedAggregate(parsed.dimensionScores, cfg.rubric, artifact);
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

  // Pure synthesis first (computes the numeric final score + gate outcome).
  const preliminary = synthesize(judgments, cfg.rubric, cfg.synthesis, cfg.gate);

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
    rationale = (await llm(synthPrompt, { tag: `synthesizer:round${round}` })).trim();
  }

  const synthesisResult = { ...preliminary, rationale };

  return {
    artifactType: artifact.type,
    round,
    judgments,
    synthesis: synthesisResult,
  };
}
