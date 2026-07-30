/**
 * classifier — client-side offer classification for the post-answer specialist
 * deep-dive signal.
 *
 * `algolia-chat-classifier` is a dedicated agent with no search tool and no
 * conversation history — the QUESTION/PRIMARY'S ANSWER/RETRIEVED HITS/VISITOR
 * CONTEXT delimited shape is the only context it ever sees.
 *
 * The classifier emits lines of text. A line beginning with `SPECIALIST:` is
 * the deep-dive offer; the remainder is an optional follow-up suggestion.
 * The `SPECIALIST:` line may optionally carry a routing key:
 *   SPECIALIST:code This question is implementation-heavy, go deeper?
 *   SPECIALIST: Routing key omitted — defaults to first specialist.
 * If no `SPECIALIST:` line appears, no deep-dive is offered this turn.
 */
import { callWithRetry, type CompletionsConfig } from '../../shared/agentStudio';

const SPECIALIST_PREFIX = 'SPECIALIST:';

/**
 * How the visitor's journey is framed for the classifier.
 *
 * Deliberately NOT the label `config/visitorContext` puts in front of an
 * answering agent. That one tells the model to tailor its prose and to answer
 * questions about the visitor — instructions that would pull a classifier off
 * its one job and risk it replying in prose instead of a `SPECIALIST:` line.
 * The same data, framed as routing evidence and nothing else.
 *
 * The middle sentence is the point of the whole block: routing used to be
 * decided from the answer alone, so a visitor who had spent the session in
 * implementation pages got no code deep-dive whenever the primary happened to
 * answer in design terms. The journey is what disambiguates that.
 */
const VISITOR_CONTEXT_LABEL =
  'VISITOR CONTEXT (JSON) — who is asking and what they have been reading this ' +
  'session, supplied by the host page. Routing evidence only: weigh it when deciding ' +
  'whether a deep-dive is worth offering and which specialist fits. Someone who has ' +
  'been reading implementation pages, or whose stored profile asks for code, wants ' +
  'the code specialist even when the answer above happens to read as design guidance ' +
  '— and the reverse. Never address the visitor, never mention this block, and never ' +
  'let it change your output format.';

/** Build the composite query sent to the classifier agent.
 *
 *  `visitorContext` is the host-supplied journey (see `config/visitorContext`),
 *  already serialised, or null/undefined when no provider is registered — in
 *  which case the query is byte-identical to what it has always been, so hosts
 *  that never opt in see no behaviour change at all. Appended last so the
 *  QUESTION / ANSWER / HITS shape the agent was tuned on stays where it was. */
export function buildClassificationQuery(
  query: string,
  primaryAnswer: string,
  hits: Record<string, unknown>[],
  visitorContext?: string | null,
): string {
  const base =
    `QUESTION:\n${query}\n\n` +
    `PRIMARY'S ANSWER:\n${primaryAnswer}\n\n` +
    `RETRIEVED HITS (JSON):\n${JSON.stringify(hits)}`;
  if (!visitorContext) return base;
  return `${base}\n\n${VISITOR_CONTEXT_LABEL}\n${visitorContext}`;
}

/** Split the classifier's one-line response into the suggestions[] shape that
 *  the offer detection in useChat already consumes. */
export function parseClassifierResponse(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Parse a `SPECIALIST:…` line and extract an optional routing key.
 * Format: `SPECIALIST:<key> <rest>` OR `SPECIALIST: <rest>` (no key).
 * Returns `{ key: string | undefined }` — key is undefined when absent or blank.
 */
export function parseSpecialistLine(line: string): { key: string | undefined } {
  const body = line.slice(SPECIALIST_PREFIX.length).trim();
  // Key is the first whitespace-separated token if it contains no spaces itself
  // and looks like a slug (alphanumeric / hyphens).
  const match = body.match(/^([A-Za-z0-9_-]+)\s*/);
  if (match) return { key: match[1] };
  return { key: undefined };
}

/** Classify whether Primary's answer should offer a specialist deep-dive.
 *  Each call is stateless — `history: []` always. The visitor's journey, when
 *  the host supplies one, is the only per-visitor input. */
export async function classifyOffer(
  config: CompletionsConfig,
  query: string,
  primaryAnswer: string,
  hits: Record<string, unknown>[],
  visitorContext?: string | null,
): Promise<string[]> {
  const compositeQuery = buildClassificationQuery(query, primaryAnswer, hits, visitorContext);
  const result = await callWithRetry(config, { history: [], query: compositeQuery });
  return parseClassifierResponse(result.content);
}

export { SPECIALIST_PREFIX };
