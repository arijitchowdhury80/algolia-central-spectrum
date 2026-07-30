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
   * LIVE judge mode: pick a fast model for the indicative on-screen verdict,
   * overridable via JUDGE_LIVE_MODEL. A future authoritative/batch path would
   * leave this off and keep the slower, more accurate default model.
   */
  fastLive?: boolean;
}

/** The fast model used for the live/indicative judge, per provider. */
function liveModelFor(env: ReturnType<typeof getEnv>, fallback: string): string {
  // No confirmed faster judge model wired per-provider yet — keep the
  // resolved default unless explicitly overridden.
  return env.JUDGE_LIVE_MODEL ?? fallback;
}

export async function makeActiveJudgeLlm(opts: ActiveJudgeOpts = {}): Promise<ActiveJudgeLlm> {
  const env = getEnv();
  const spec = resolveActiveProvider(env);
  const apiKey = env[spec.keyVar] ?? "";
  const model = opts.fastLive ? liveModelFor(env, spec.judgeModel) : spec.judgeModel;
  // openai + inference both ride the OpenAI client (inference is
  // OpenAI-compatible, differing only by baseURL). spec.baseURL is set only
  // for inference, so openai keeps its default host.
  const rawLlm = makeOpenAIComplete({ apiKey, model, baseURL: spec.baseURL });
  const judgeLlm = makeJudgeLlm(rawLlm, DEFAULT_JUDGE_CONFIG.rubric);
  const usageCalls: UsageCall[] = [];
  const llm = withUsageCapture(judgeLlm, (u) => usageCalls.push(u));
  return { llm, provider: spec.provider, model, usageCalls };
}
