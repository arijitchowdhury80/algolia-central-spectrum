/**
 * llmRates — published per-1M-token USD rates for the LLMs the ACS judge
 * (and, prospectively, the client's server-side calls) can be configured to
 * use. Cost tracking (spike plan §6): EXACT token counts (captured in
 * gemini.ts/openai.ts via `onUsage`) × these PUBLISHED rates = an EXACT cost,
 * as opposed to the web client's text-length ESTIMATE for Agent Studio calls
 * (which exposes no token usage on the wire at all — see web/src/lib/
 * costEstimate.ts).
 *
 * Sources (captured 2026-07-19, subject to provider changes without notice):
 *   - gemini-2.5-flash / gemini-2.5-pro: https://ai.google.dev/gemini-api/docs/pricing
 *     (confirmed ground truth for this session, per team-lead brief).
 *   - gpt-4o-mini / gpt-4o: https://openai.com/api/pricing/ (published rates,
 *     standard tier, no batch/cached discount applied).
 */

export interface LlmRate {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
}

export const LLM_RATES: Readonly<Record<string, LlmRate>> = {
  "gemini-2.5-flash": { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  "gemini-2.5-pro": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.0 },
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "gpt-4o": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10.0 },
};

/**
 * EXACT tokens × published rate. Returns `undefined` (never throws, never
 * silently fabricates a number) when `model` has no entry in `LLM_RATES` —
 * callers sum only the calls with a known rate and can surface "N calls at
 * an unpriced model" separately rather than lying about the total.
 */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const rate = LLM_RATES[model];
  if (!rate) return undefined;
  return (inputTokens / 1_000_000) * rate.inputPerMillionUsd + (outputTokens / 1_000_000) * rate.outputPerMillionUsd;
}
