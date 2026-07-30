/**
 * costEstimate — ESTIMATED cost for an Agent Studio (Generic/Technical/
 * Classifier) call.
 *
 * Confirmed empirically (spike plan §6, live SSE capture): Agent Studio's
 * wire protocol exposes ZERO token usage — the `d:`/`e:` finish frames carry
 * only `{"finishReason":"stop"}`. There is no exact number to read, ever, for
 * these 3 agents; this module produces the best-effort ESTIMATE instead, and
 * every value it returns is labeled `method: "ESTIMATED"` so the UI can never
 * present it as the judge's EXACT provider-reported usage
 * (lab/server/src/usage.ts).
 *
 * Heuristic: ~4 characters per token (a commonly-cited rough average for
 * English text across tokenizers — NOT a measured constant for any specific
 * model's tokenizer). Applied to: question + sources text as "input", answer
 * text as "output". Priced at gemini-2.5-flash's published rate (the model
 * ACS's live agents actually run on — see docs/... instance config), the same
 * rate lab/server/src/llmRates.ts uses for the judge's fast/live model, so an
 * agent card and a judge card in the same UI are at least priced consistently
 * even though one is exact and the other is a guess.
 */

const CHARS_PER_TOKEN = 4;

/** gemini-2.5-flash published rate, USD per 1M tokens. Mirrors
 *  lab/server/src/llmRates.ts's entry — duplicated here (not imported) because
 *  the web app and lab/server are separate deployables that only talk over
 *  HTTP, never share a package. */
const FLASH_RATE = { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 };

export interface EstimatedCost {
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly estimatedCostUsd: number;
  readonly model: "gemini-2.5-flash";
  readonly method: "ESTIMATED";
}

/** chars/4, rounded up — a 0-length string still costs 0, never negative/NaN. */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface AgentCostInput {
  readonly question: string;
  readonly answer: string;
  /** Retrieved source body text the answer was grounded in (for the "input" side). */
  readonly sourcesText?: readonly string[];
}

/** Estimate one Agent Studio answer's cost. Pure — no network, no state. */
export function estimateAgentCost(input: AgentCostInput): EstimatedCost {
  const sourcesJoined = (input.sourcesText ?? []).join("\n");
  const estimatedInputTokens = estimateTokens(input.question) + estimateTokens(sourcesJoined);
  const estimatedOutputTokens = estimateTokens(input.answer);
  const estimatedCostUsd =
    (estimatedInputTokens / 1_000_000) * FLASH_RATE.inputPerMillionUsd +
    (estimatedOutputTokens / 1_000_000) * FLASH_RATE.outputPerMillionUsd;
  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    model: "gemini-2.5-flash",
    method: "ESTIMATED",
  };
}
