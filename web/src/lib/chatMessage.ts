/**
 * chatMessage — pure extraction helpers over a chat message's `parts` array
 * (react-instantsearch's `UIMessagePart` union, from
 * `instantsearch-ui-components`). They translate message parts into the plain
 * `text` / normalized `sources` / raw `hits` primitives the rest of the app
 * (turn model, judge, cost) consumes.
 *
 * Part variants handled:
 *  - `TextUIPart {type:'text', text}` → answer text.
 *  - `SourceUrlUIPart {type:'source-url', sourceId, url, title?}` and
 *    `SourceDocumentUIPart {type:'source-document', sourceId, title, ...}` →
 *    one synthesized raw hit each (`{objectID, title, url}`), run through
 *    `sources.ts`'s `normalizeHit` so this module never re-implements that
 *    normalization.
 *  - `ToolUIPart` whose type starts with `tool-` and whose `state` is
 *    `'output-available'`, carrying `output.hits` (the Algolia search tool's
 *    result shape — confirmed against
 *    `react-instantsearch/dist/es/widgets/chat/tools/SearchIndexTool.js`,
 *    which reads `message.output.hits`) → each hit is a raw Agent Studio-style
 *    record and goes through `normalizeHit` directly.
 *  - Everything else (`reasoning`, `file`, `step-start`, `dynamic-tool`,
 *    `data-*`) is ignored — none of them carry answer text or grounded
 *    citations.
 *
 * Pure, no DOM, no React — matches this repo's test style (see
 * `hooks/useChat.test.ts`): source-string/fixture asserts, no render harness.
 */
import { normalizeHit } from './sources';
import type { AnswerSource } from '../types';

/** Loosened structural shapes for the part fields we actually read — kept
 *  local (rather than importing `instantsearch-ui-components`'s generic
 *  `UIMessagePart<TDataTypes, TTools>` union) so this module has no compile
 *  dependency on that package's tool-type generics, which we don't use. */
export interface TextPart {
  type: 'text';
  text: string;
}

export interface SourceUrlPart {
  type: 'source-url';
  sourceId: string;
  url: string;
  title?: string;
}

export interface SourceDocumentPart {
  type: 'source-document';
  sourceId: string;
  title: string;
}

/** A search/recommend tool part once its output has arrived. `type` is
 *  `tool-${toolName}` (e.g. `tool-algolia_search_index`) per
 *  `instantsearch.js`'s tool type constants; only `output.hits` is read. */
export interface ToolOutputPart {
  type: string; // `tool-${string}`
  state: 'output-available';
  output?: { hits?: Record<string, unknown>[] };
}

/** Any other part shape — ignored for both text and source extraction. */
export interface OtherPart {
  type: string;
  [key: string]: unknown;
}

export type ChatMessagePart =
  | TextPart
  | SourceUrlPart
  | SourceDocumentPart
  | ToolOutputPart
  | OtherPart;

function isTextPart(p: ChatMessagePart): p is TextPart {
  return p.type === 'text' && typeof (p as TextPart).text === 'string';
}

function isSourceUrlPart(p: ChatMessagePart): p is SourceUrlPart {
  return p.type === 'source-url';
}

function isSourceDocumentPart(p: ChatMessagePart): p is SourceDocumentPart {
  return p.type === 'source-document';
}

function isToolOutputPart(p: ChatMessagePart): p is ToolOutputPart {
  return (
    p.type.startsWith('tool-') &&
    (p as ToolOutputPart).state === 'output-available' &&
    Array.isArray((p as ToolOutputPart).output?.hits)
  );
}

/** Join every `text` part's text into the full answer. Multiple text parts
 *  can appear around tool calls (text → search → text); joined with a blank
 *  line so a mid-answer tool call doesn't run two sentences together.
 *  Empty/whitespace-only parts contribute nothing; no parts → `''`. */
export function answerText(parts: readonly ChatMessagePart[]): string {
  const chunks = parts
    .filter(isTextPart)
    .map((p) => p.text.trim())
    .filter((t) => t.length > 0);
  return chunks.join('\n\n');
}

/** Extract grounded `AnswerSource`s from `source-url`/`source-document` parts
 *  and from search-tool `output.hits`, normalized via `sources.ts`'s
 *  `normalizeHit` — the same normalization used app-wide, so
 *  downstream grouping/pill rendering is identical either way. Order:
 *  parts appear in message order; within a tool-output part, hits keep their
 *  result order. No dedup here — `groupSources` (sources.ts) already dedupes
 *  when these are rendered/grouped. Empty/no-match parts → `[]`. */
export function sourcesFromParts(parts: readonly ChatMessagePart[]): AnswerSource[] {
  const out: AnswerSource[] = [];
  for (const p of parts) {
    if (isSourceUrlPart(p)) {
      const hit = normalizeHit({ objectID: p.sourceId, title: p.title, url: p.url });
      if (hit) out.push(hit);
      continue;
    }
    if (isSourceDocumentPart(p)) {
      const hit = normalizeHit({ objectID: p.sourceId, title: p.title });
      if (hit) out.push(hit);
      continue;
    }
    if (isToolOutputPart(p)) {
      for (const rawHit of p.output!.hits!) {
        const hit = normalizeHit(rawHit);
        if (hit) out.push(hit);
      }
    }
  }
  return out;
}

/** Raw hit objects (pre-normalization) drawn from search-tool `output.hits`
 *  parts only — this is what `useJudge`/`useCostRecording` need
 *  (`AnswerSegment.rawHits`) since they read each hit's full body text, which
 *  `AnswerSource`/`normalizeHit` intentionally drops. `source-url`/
 *  `source-document` parts carry no body text, so they're not included here. */
export function rawHitsFromParts(parts: readonly ChatMessagePart[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const p of parts) {
    if (isToolOutputPart(p)) out.push(...p.output!.hits!);
  }
  return out;
}

/** Minimal message shape read by the message-level helpers below — an id, a
 *  role, and the parts array. Structurally a subset of `ChatMessageBase`. */
export interface ChatMessageLike {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: readonly ChatMessagePart[];
}

/**
 * Resolve the user question a given assistant message answers.
 *
 * The `useChat` `onFinish` callback gives the finished assistant `message` plus the
 * full `messages` array, but no direct "which question was this" link — so we
 * recover it structurally: find the assistant message by id, then walk
 * BACKWARDS to the nearest preceding `user` message and read its text. Returns
 * `''` when the id isn't found, there's no preceding user turn, or that turn
 * has no text (callers treat `''` as "can't classify / can't judge this").
 *
 * Walking back from the assistant (rather than forward, or "last user
 * message") keeps the pairing correct in multi-turn transcripts where several
 * turns are already on screen — the question is always the user message
 * immediately above THIS answer, not the most recent one overall.
 */
export function questionFromMessages(
  messages: readonly ChatMessageLike[],
  assistantMessageId: string,
): string {
  const idx = messages.findIndex((m) => m.id === assistantMessageId);
  if (idx === -1) return '';
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return answerText(messages[i].parts);
  }
  return '';
}

/** Guard for "should we run the classifier / judge on this finished turn".
 *  An aborted, errored, or empty-text answer never gets an offer or a judge
 *  score — mirrors the offer guard (it
 *  short-circuits `deriveOfferState([], query)` on an empty answer). Pure so
 *  it's unit-testable without a live finish event. */
export function canClassify(opts: {
  isAbort?: boolean;
  isError?: boolean;
  text: string;
  question: string;
}): boolean {
  if (opts.isAbort || opts.isError) return false;
  return opts.text.trim().length > 0 && opts.question.trim().length > 0;
}
