/**
 * usage — accumulates EXACT LLM token usage across every call made while
 * judging one /api/judge request, and prices it via llmRates.ts.
 *
 * Cost tracking (spike plan §6). The judge module (`@lab/judge`) makes many
 * `LlmComplete` calls per request (one per judge persona per round, plus the
 * synthesizer and the follow-up-quality scorer) — none of them know about
 * cost. `withUsageCapture` wraps the already-resolved `LlmComplete` (after
 * `activeJudgeLlm`'s provider selection + `makeJudgeLlm`'s dimension-id
 * repair) so every call's `onUsage` sink (see lab/judge/src/types.ts)
 * lands in ONE array scoped to that request, regardless of how many
 * internal calls the judge module makes.
 */
import type { LlmComplete, LlmCompleteOptions, LlmUsage } from "@lab/judge";
import { costUsd } from "./llmRates.js";

export interface UsageCall {
  readonly tag?: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface UsageSummary {
  readonly calls: readonly UsageCall[];
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  /** Sum of only the calls whose model has a published rate (llmRates.ts). */
  readonly estimatedCostUsd: number;
  /** True iff at least one call's model has no entry in LLM_RATES (its cost is excluded above, not fabricated). */
  readonly hasUnpricedCalls: boolean;
}

/** Wrap `llm` so every call's provider-reported usage (if any) is pushed onto `sink`. */
export function withUsageCapture(llm: LlmComplete, sink: (u: UsageCall) => void): LlmComplete {
  return async function usageCapturingComplete(prompt: string, opts?: LlmCompleteOptions): Promise<string> {
    const onUsage = (u: LlmUsage) => {
      sink({ tag: u.tag, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens });
      opts?.onUsage?.(u);
    };
    return llm(prompt, { ...opts, onUsage });
  };
}

/** Pure aggregation: token totals + priced cost (llmRates.ts) over a request's captured calls. */
export function summarizeUsage(calls: readonly UsageCall[]): UsageSummary {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let estimatedCostUsd = 0;
  let hasUnpricedCalls = false;
  for (const c of calls) {
    totalInputTokens += c.inputTokens;
    totalOutputTokens += c.outputTokens;
    const cost = costUsd(c.model, c.inputTokens, c.outputTokens);
    if (cost === undefined) {
      hasUnpricedCalls = true;
    } else {
      estimatedCostUsd += cost;
    }
  }
  return { calls, totalInputTokens, totalOutputTokens, estimatedCostUsd, hasUnpricedCalls };
}
