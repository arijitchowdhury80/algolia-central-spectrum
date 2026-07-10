/**
 * classifier — client-side offer classification for the post-answer
 * specialist deep-dive signal (Track A, replacing the old
 * `genericResult.suggestions` / native `config.suggestions` mechanism — see
 * useChat.ts's header for the retired mechanism this supersedes).
 *
 * `ACS-classifier-neural` (scripts/agents/instructions_classifier.md) is a
 * dedicated agent with no search tool and no conversation history — the
 * QUESTION/GENERIC'S ANSWER/RETRIEVED HITS delimited shape built by
 * `buildClassificationQuery` below is the ONLY context it ever sees. That
 * shape must stay byte-compatible with the prompt's own pinned input
 * contract (instructions_classifier.md) — see docs/spikes/2026-07-10-*
 * (Task A5) for the real empirical capture proving prompt and client agree.
 */
import { callWithRetry } from './agentStudio';
import type { CompletionsConfig } from './agentStudio';

/** Build the composite query sent to the classifier agent. */
export function buildClassificationQuery(
  query: string,
  genericAnswer: string,
  hits: Record<string, unknown>[],
): string {
  return (
    `QUESTION:\n${query}\n\n` +
    `GENERIC'S ANSWER:\n${genericAnswer}\n\n` +
    `RETRIEVED HITS (JSON):\n${JSON.stringify(hits)}`
  );
}

/** Split the classifier's one-line-plain-text response into the same
 *  suggestions[] shape `extractDeepDiveOffer`/`deriveOfferState` already
 *  consume — defensive, never throws on a stray blank line or extra
 *  whitespace (matches the "malformed input degrades gracefully" discipline
 *  every other parser in this codebase follows). */
export function parseClassifierResponse(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Classify whether Generic's answer should offer a specialist deep-dive.
 *  Each call is independent — `history: []` always, since the classifier
 *  has no cross-turn state. Resilience (retry-once) is inherited from
 *  `callWithRetry`, shared with the Generic/Technical legs. */
export async function classifyOffer(
  config: CompletionsConfig,
  query: string,
  genericAnswer: string,
  hits: Record<string, unknown>[],
): Promise<string[]> {
  const compositeQuery = buildClassificationQuery(query, genericAnswer, hits);
  const result = await callWithRetry(config, { history: [], query: compositeQuery });
  return parseClassifierResponse(result.content);
}
