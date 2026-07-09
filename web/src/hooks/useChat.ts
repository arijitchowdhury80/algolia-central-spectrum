/**
 * useChat — the client baton orchestration (the app's core feature).
 *
 * Drives the Generic -> [offer? -> Technical] flow off Agent Studio's native
 * `config.suggestions` mechanism (no tool call, no pause, no text sentinel):
 *   1. Call Generic with running history. Stream its full answer live — the
 *      answer text is already clean, there is nothing to strip.
 *   2. After the answer, Generic's native suggestions fire. The frontend reads
 *      `genericResult.suggestions`. A suggestion prefixed `SPECIALIST:` is a
 *      deep-dive offer; any other suggestion is an ordinary follow-up. Both are
 *      derived in one shot by `deriveOfferState`, so `deepDiveOffered` and
 *      `deepDiveQuery` can never disagree.
 *   3. Deep-dive stays human-gated: only on `runDeepDive` do we call Technical,
 *      passing `turn.deepDiveQuery` (the user's original turn text, verbatim)
 *      plus Generic's answer as separate context — never concatenated.
 *   4. Persist each turn's final assistant content (Generic, +Technical if the
 *      user accepted) into `turns` so the NEXT call's history is correct.
 *
 * Agent IDs now come from the active instance config (not hardcoded) — see
 * lib/agents.ts header for why.
 */
import { useState, useCallback, useRef } from 'react';
import { callCompletions } from '../lib/agentStudio';
import { getAgentConfig } from '../lib/agents';
import { normalizeHit, groupSources, totalSources } from '../lib/sources';
import { activeInstance } from '../config/active';
import type { AnswerSegment, AnswerSource, ChatTurn, HistoryEntry } from '../types';
import type { CompletionsConfig, CompletionsRequest, ParsedCompletion } from '../lib/agentStudio';

/** Pull the first `SPECIALIST:`-prefixed deep-dive offer out of a turn's native
 *  suggestions. Returns its trimmed remainder as `offer` and the remaining
 *  suggestions as `rest` (the matched entry removed so it never also renders as
 *  an ordinary follow-up). If none is prefixed, returns `{ rest: suggestions }`
 *  unchanged. */
export function extractDeepDiveOffer(
  suggestions: string[],
): { offer?: string; rest: string[] } {
  // Normalize (trim + uppercase) before matching to tolerate the whitespace/case
  // drift a live LLM completion can emit (' SPECIALIST:', 'Specialist:'), but
  // slice the prefix off the trimmed ORIGINAL so the offer text keeps its casing.
  const idx = suggestions.findIndex((s) => s.trim().toUpperCase().startsWith('SPECIALIST:'));
  if (idx === -1) return { rest: suggestions };
  return {
    offer: suggestions[idx].trim().slice('SPECIALIST:'.length).trim(),
    rest: suggestions.filter((_, i) => i !== idx),
  };
}

/** Derive the turn's offer state from its suggestions in ONE place, so
 *  `deepDiveOffered` and `deepDiveQuery` are always sourced from the same
 *  `offer` value and can never disagree (architecture-review Critical #2).
 *  `deepDiveQuery` is `turnQuery` verbatim when an offer exists — never a
 *  concatenation with Generic's answer (Critical #1). */
export function deriveOfferState(
  suggestions: string[],
  turnQuery: string,
): { deepDiveOffered: boolean; followUp?: string; deepDiveQuery?: string } {
  const { offer, rest } = extractDeepDiveOffer(suggestions);
  return {
    deepDiveOffered: !!offer,
    followUp: rest[0],
    deepDiveQuery: offer ? turnQuery : undefined,
  };
}

/** Build the specialist's prior-history array. The `user` entry is `query`
 *  ALONE (verbatim) and Generic's answer is a SEPARATE `assistant` entry —
 *  pulled out as a pure function so the double-user-turn regression (Critical
 *  #1: `query` must never be concatenated with `genericText`) is directly
 *  testable. */
export function buildTechnicalHistory(
  priorHistory: HistoryEntry[],
  query: string,
  genericText: string,
): HistoryEntry[] {
  return [
    ...priorHistory,
    { role: 'user', content: query },
    { role: 'assistant', content: genericText },
  ];
}

/** Normalize + dedupe raw Agent Studio hits into AnswerSource[]. */
function normalizeSources(hits: Record<string, unknown>[]): AnswerSource[] {
  const sources: AnswerSource[] = [];
  for (const h of hits) {
    const s = normalizeHit(h);
    if (s) sources.push(s);
  }
  // Dedupe via the same grouping logic the UI uses, then flatten back.
  const groups = groupSources(sources);
  return groups.flatMap((g) => g.sources);
}

/** Deterministically shrink an earlier turn's answer for replay as history
 *  (R11). No LLM call — an agent-emitted summary would be untrusted content
 *  compounding into future turns' premises, and a second per-turn call besides.
 *  Passthrough when `text.length <= maxLen`; otherwise cut back to the last
 *  whitespace boundary (never mid-word) and append ' …'. The ellipsis budget is
 *  reserved inside `maxLen`, so the result is always `<= maxLen`. A pathological
 *  single long token with no whitespace is hard-truncated with a trailing '…'. */
export function summarizeForHistory(text: string, maxLen = 240): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen - 2);
  const atBoundary = slice.replace(/\S*$/, '').trimEnd();
  if (atBoundary.length === 0) return text.slice(0, maxLen - 1) + '…';
  return atBoundary + ' …';
}

/** Summarize a multi-segment answer for replay as history, giving each segment
 *  its OWN budget rather than end-truncating the flat concatenation. A flat
 *  end-truncation drops the LAST segment entirely once the first fills `maxLen`
 *  — which silently deletes the Technical (deep-dive) answer, the most specific
 *  and whole-point-of-the-feature content, from every subsequent turn's context
 *  (WR-01). The last segment is always the most specific, so it gets a double
 *  share of the budget; earlier segments split the remainder evenly. The join
 *  separators ('\n\n') are reserved out of `maxLen` so the result is `<= maxLen`. */
export function summarizeSegmentsForHistory(texts: string[], maxLen = 240): string {
  if (texts.length === 0) return '';
  if (texts.length === 1) return summarizeForHistory(texts[0], maxLen);
  const sepBudget = (texts.length - 1) * 2; // reserve for '\n\n' joins
  const budget = maxLen - sepBudget;
  const totalWeight = texts.length - 1 + 2; // last segment weighted x2
  const unit = Math.floor(budget / totalWeight);
  return texts
    .map((t, i) => {
      const isLast = i === texts.length - 1;
      const segBudget = isLast ? budget - unit * (texts.length - 1) : unit;
      return summarizeForHistory(t, segBudget);
    })
    .join('\n\n');
}

/** Turn a completed turn into the {role,content} pairs Agent Studio expects
 *  as prior history. Turns with no successful segment are skipped entirely
 *  (an unanswered question shouldn't be replayed as context). The assistant
 *  answer is summarized (R11) because `turnToHistory` only ever runs on turns
 *  strictly before the current one (via `historyBefore`'s `slice(0, idx)`), so
 *  every answer it emits is an earlier round — the current round's own answer
 *  flows separately (`genericText`) and is never touched. The question stays
 *  verbatim. Exported for the R11 integration test. */
export function turnToHistory(t: ChatTurn): HistoryEntry[] {
  const answered = t.segments.filter((s) => s.status === 'success' && s.text.trim());
  if (answered.length === 0) return [];
  return [
    { role: 'user', content: t.query },
    { role: 'assistant', content: summarizeSegmentsForHistory(answered.map((s) => s.text)) },
  ];
}

function historyBefore(turns: ChatTurn[], turnId: string | null): HistoryEntry[] {
  const idx = turnId ? turns.findIndex((t) => t.id === turnId) : turns.length;
  const prior = idx === -1 ? turns : turns.slice(0, idx);
  return prior.flatMap(turnToHistory);
}

/** Best-effort human-readable error message. Never surfaces a raw stack —
 *  callers (ErrorCard) show a fixed friendly string keyed by agent name;
 *  this is kept only for future debugging hooks (e.g. console/telemetry). */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Call completions with one automatic retry on either failure mode of the
 *  known Agent Studio flake (SESSION.md, ~1-in-8 baseline): a thrown
 *  network/HTTP error, OR a successful-but-empty completion with no error.
 *  Previously only the empty-completion case retried — a genuine thrown
 *  error went straight to the error card with zero retry, which is the
 *  gap behind a real "couldn't reach the agent" report. Re-throws if the
 *  retry also fails, for the caller's own try/catch to turn into the
 *  error-card UI state. */
async function callWithRetry(
  config: CompletionsConfig,
  req: CompletionsRequest,
  onText: (accumulated: string) => void,
): Promise<ParsedCompletion> {
  try {
    const result = await callCompletions(config, req, onText);
    if (!result.error && !result.content.trim()) {
      return await callCompletions(config, req, onText);
    }
    return result;
  } catch {
    return await callCompletions(config, req, onText);
  }
}

export interface UseChatResult {
  turns: ChatTurn[];
  isStreaming: boolean;
  sendMessage: (query: string) => Promise<void>;
  retryTurn: (turnId: string) => Promise<void>;
  /** Accept the specialist deep-dive offer for a turn (runs the specialist). */
  runDeepDive: (turnId: string) => Promise<void>;
  /** Decline the specialist deep-dive offer for a turn. */
  declineDeepDive: (turnId: string) => void;
  /** Clear the entire conversation — back to the empty state. */
  reset: () => void;
}

export function useChat(): UseChatResult {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  // Mirrors `turns` synchronously so retry/run helpers always read the latest
  // list even inside async callbacks (React state updates are batched/async).
  const turnsRef = useRef<ChatTurn[]>([]);
  turnsRef.current = turns;

  const updateSegment = useCallback(
    (turnId: string, index: number, patch: Partial<AnswerSegment>) => {
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          const segments = t.segments.slice();
          segments[index] = { ...segments[index], ...patch };
          return { ...t, segments };
        }),
      );
    },
    [],
  );

  const appendSegment = useCallback((turnId: string, segment: AnswerSegment) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId
          ? { ...t, segments: [...t.segments, segment], handoff: true, deepDiveOffered: false }
          : t,
      ),
    );
  }, []);

  /** Run one full turn (Generic; Technical only on later user consent).
   *  `priorHistory` is the conversation context as of just before this turn. */
  const runTurn = useCallback(
    async (turnId: string, query: string, priorHistory: HistoryEntry[]) => {
      setIsStreaming(true);
      try {
        // --- Generic leg ---
        let genericResult;
        try {
          genericResult = await callWithRetry(
            getAgentConfig(activeInstance.agents.generic.id),
            { history: priorHistory, query },
            (accumulated) => {
              updateSegment(turnId, 0, { status: 'streaming', text: accumulated });
            },
          );
        } catch (err) {
          updateSegment(turnId, 0, { status: 'error', error: toErrorMessage(err) });
          return;
        }

        const genericText = genericResult.content;
        const genericSources = normalizeSources(genericResult.hits);

        if (genericResult.error) {
          updateSegment(turnId, 0, {
            status: 'error',
            text: genericText,
            sources: genericSources,
            searchCount: totalSources(groupSources(genericSources)),
            error: genericResult.error,
            rawHits: genericResult.hits,
          });
          return;
        }

        updateSegment(turnId, 0, {
          status: 'success',
          text: genericText,
          sources: genericSources,
          searchCount: totalSources(groupSources(genericSources)),
          rawHits: genericResult.hits,
        });

        // Deep-dive is HUMAN-GATED: a `SPECIALIST:`-prefixed native suggestion
        // only OFFERS the specialist (never auto-runs). `deriveOfferState`
        // derives deepDiveOffered / followUp / deepDiveQuery from the same
        // `offer` value in one shot, so they can never disagree. `query` here
        // is runTurn's own parameter, always equal to turn.query.
        const patch = deriveOfferState(genericResult.suggestions, query);
        setTurns((prev) =>
          prev.map((t) => (t.id === turnId ? { ...t, ...patch } : t)),
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [updateSegment],
  );

  /** Run the specialist deep-dive leg for a turn. Only ever called on explicit
   *  user consent (runDeepDive) — never auto-chained after the first answer.
   *  Appends a second segment and streams the specialist's answer into it. */
  const runTechnicalLeg = useCallback(
    async (turnId: string, query: string, priorHistory: HistoryEntry[], genericText: string) => {
      setIsStreaming(true);
      try {
        const technicalSegment: AnswerSegment = {
          agent: 'technical',
          status: 'loading',
          text: '',
          sources: [],
          searchCount: 0,
        };
        appendSegment(turnId, technicalSegment);

        const technicalHistory = buildTechnicalHistory(priorHistory, query, genericText);

        const onTechToken = (accumulated: string) =>
          updateSegment(turnId, 1, { status: 'streaming', text: accumulated });

        let technicalResult;
        try {
          technicalResult = await callWithRetry(
            getAgentConfig(activeInstance.agents.technical.id),
            { history: technicalHistory, query },
            onTechToken,
          );
        } catch (err) {
          updateSegment(turnId, 1, { status: 'error', error: toErrorMessage(err) });
          return;
        }

        const technicalText = technicalResult.content;
        const { rest: technicalRest } = extractDeepDiveOffer(technicalResult.suggestions);
        const technicalSources = normalizeSources(technicalResult.hits);
        if (technicalResult.error) {
          updateSegment(turnId, 1, {
            status: 'error',
            text: technicalText,
            sources: technicalSources,
            searchCount: totalSources(groupSources(technicalSources)),
            error: technicalResult.error,
            rawHits: technicalResult.hits,
          });
          return;
        }

        updateSegment(turnId, 1, {
          status: 'success',
          text: technicalText,
          sources: technicalSources,
          searchCount: totalSources(groupSources(technicalSources)),
          rawHits: technicalResult.hits,
        });
        // Technical's answer is the deepest, most specific point in the
        // conversation — its own follow-up (if it gave one) replaces
        // Generic's earlier, less-specific one as the turn's discovery card.
        if (technicalRest[0]) {
          setTurns((prev) =>
            prev.map((t) => (t.id === turnId ? { ...t, followUp: technicalRest[0] } : t)),
          );
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [appendSegment, updateSegment],
  );

  /** User accepted the deep-dive offer → run the specialist leg. Uses
   *  `turn.deepDiveQuery` (the user's original turn text, verbatim, set when the
   *  offer was made), falling back to `turn.query` defensively. */
  const runDeepDive = useCallback(
    async (turnId: string) => {
      if (isStreaming) return;
      const turn = turnsRef.current.find((t) => t.id === turnId);
      if (!turn || !turn.deepDiveOffered || turn.handoff) return;
      const genericText = turn.segments[0]?.text ?? '';
      const priorHistory = historyBefore(turnsRef.current, turnId);
      const resolvedQuery = turn.deepDiveQuery ?? turn.query;
      await runTechnicalLeg(turnId, resolvedQuery, priorHistory, genericText);
    },
    [isStreaming, runTechnicalLeg],
  );

  /** User dismissed the deep-dive offer for this turn. */
  const declineDeepDive = useCallback((turnId: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, deepDiveOffered: false, deepDiveDeclined: true } : t,
      ),
    );
  }, []);

  const sendMessage = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed || isStreaming) return;

      const turnId = crypto.randomUUID();
      const priorHistory = historyBefore(turnsRef.current, null);
      const newTurn: ChatTurn = {
        id: turnId,
        query: trimmed,
        handoff: false,
        deepDiveOffered: false,
        segments: [{ agent: 'generic', status: 'loading', text: '', sources: [], searchCount: 0 }],
      };
      setTurns((prev) => [...prev, newTurn]);

      await runTurn(turnId, trimmed, priorHistory);
    },
    [isStreaming, runTurn],
  );

  const retryTurn = useCallback(
    async (turnId: string) => {
      if (isStreaming) return;
      const turn = turnsRef.current.find((t) => t.id === turnId);
      if (!turn) return;

      const priorHistory = historyBefore(turnsRef.current, turnId);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                handoff: false,
                deepDiveOffered: false,
                deepDiveDeclined: false,
                followUp: undefined,
                deepDiveQuery: undefined,
                segments: [{ agent: 'generic', status: 'loading', text: '', sources: [], searchCount: 0 }],
              }
            : t,
        ),
      );

      await runTurn(turnId, turn.query, priorHistory);
    },
    [isStreaming, runTurn],
  );

  /** Reset the whole session: drop every turn and any in-flight streaming
   *  state, returning the UI to its empty state. In-flight agent stream
   *  callbacks become no-ops (they map over turns by id, which no longer
   *  exist), so a mid-stream reset is safe. */
  const reset = useCallback(() => {
    turnsRef.current = [];
    setTurns([]);
    setIsStreaming(false);
  }, []);

  return { turns, isStreaming, sendMessage, retryTurn, runDeepDive, declineDeepDive, reset };
}
