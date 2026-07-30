/**
 * activeJudgeLlm — build the judge's LLM from the resolved provider.
 *
 * ADAPTED from AC2 lab/server/src/activeJudgeLlm.ts: same shape (resolve
 * provider -> pick raw LlmComplete -> wrap with makeJudgeLlm for dimension-id
 * normalisation), but calls the simplified (sync, no health-probe)
 * `resolveActiveProvider` from ./provider.ts instead of AC2's Agent-Studio-
 * entangled OpenAI-preferred resolver.
 */
import { DEFAULT_JUDGE_CONFIG, type LlmComplete } from "@lab/judge";
import { getEnv } from "./config.js";
import { makeOpenAIComplete } from "./openai.js";
import { makeGeminiComplete } from "./gemini.js";
import { makeJudgeLlm } from "./judgeLlm.js";
import { resolveActiveProvider } from "./provider.js";
import { withUsageCapture, type UsageCall } from "./usage.js";

export interface ActiveJudgeLlm {
  llm: LlmComplete;
  provider: string;
  model: string;
  /**
   * Mutable accumulator — every call `llm` makes (judge personas, synthesizer,
   * follow-up scorer) pushes its EXACT usage here as it resolves. Scoped to
   * ONE `makeActiveJudgeLlm` call, i.e. one /api/judge request — read this
   * AFTER awaiting the judge, not before. Cost tracking §6.
   */
  usageCalls: UsageCall[];
}

export interface ActiveJudgeOpts {
  /**
   * LIVE judge mode: pick a fast model for the indicative on-screen verdict.
   * For gemini that's gemini-2.5-flash (override via JUDGE_LIVE_MODEL) —
   * markedly faster than pro. A future authoritative/batch path would leave
   * this off and keep the slower, more accurate default model.
   */
  fastLive?: boolean;
}

/** The fast model used for the live/indicative judge, per provider. */
function liveModelFor(env: ReturnType<typeof getEnv>, provider: string, fallback: string): string {
  if (provider === "gemini") return env.JUDGE_LIVE_MODEL ?? "gemini-2.5-flash";
  // OpenAI: no confirmed faster judge model wired — keep the resolved default.
  return env.JUDGE_LIVE_MODEL ?? fallback;
}

export async function makeActiveJudgeLlm(opts: ActiveJudgeOpts = {}): Promise<ActiveJudgeLlm> {
  const env = getEnv();
  const spec = resolveActiveProvider(env);
  const apiKey = env[spec.keyVar] ?? "";
  const model = opts.fastLive
    ? liveModelFor(env, spec.provider, spec.judgeModel)
    : spec.judgeModel;
  // gemini → native Gemini client; openai + inference → OpenAI client (inference
  // is OpenAI-compatible, differing only by baseURL). spec.baseURL is set only
  // for inference, so openai keeps its default host.
  const rawLlm =
    spec.provider === "gemini"
      ? makeGeminiComplete({ apiKey, model })
      : makeOpenAIComplete({ apiKey, model, baseURL: spec.baseURL });
  const judgeLlm = makeJudgeLlm(rawLlm, DEFAULT_JUDGE_CONFIG.rubric);
  const usageCalls: UsageCall[] = [];
  const llm = withUsageCapture(judgeLlm, (u) => usageCalls.push(u));
  return { llm, provider: spec.provider, model, usageCalls };
}
