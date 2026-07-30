/**
 * agentStudioLlmAdapter — an `LlmComplete` adapter (the confidence engine's
 * only seam to a real model) backed by an Algolia Agent Studio agent instead
 * of a direct model-provider call.
 *
 * Lets the whole provider-agnostic judge engine run IN THE BROWSER against the
 * same search-only Algolia key the chat already uses — no VPS judge service and
 * no `x-lab-key`.
 */
import { callWithRetry, type CompletionsConfig } from '../shared/agentStudio';
import type { LlmComplete } from './engine';

/** Build an `LlmComplete` bound to one Agent Studio judge-backend agent. Each
 *  call is stateless (`history: []`) — a judge scores exactly the artifact the
 *  prompt embeds, with no cross-call memory. */
export function makeAgentStudioLlm(config: CompletionsConfig): LlmComplete {
  return async (prompt: string): Promise<string> => {
    const result = await callWithRetry(config, { history: [], query: prompt });
    if (result.error) {
      throw new Error(`Judge agent error: ${result.error}`);
    }
    return result.content;
  };
}
