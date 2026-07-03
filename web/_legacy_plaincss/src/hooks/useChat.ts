/**
 * useChat — the client baton orchestration (the app's core feature).
 *
 * Owns the turn list and drives the Generic -> [sentinel? -> Technical] flow:
 *   1. Call Generic with running history. Stream text live.
 *   2. Watch the accumulated Generic text for HANDOFF_SENTINEL. If present,
 *      strip it, mark the turn as a handoff, and call Technical with
 *      history = [...priorHistory, user turn, Generic's stripped answer].
 *   3. Persist each turn's final assistant content (Generic, +Technical if
 *      handed off) into `turns` so the NEXT call's history is correct.
 */
import { useState, useCallback, useRef } from 'react';
import { callCompletions } from '../lib/agentStudio';
import { getGenericConfig, getTechnicalConfig, HANDOFF_SENTINEL } from '../lib/agents';
import { normalizeHit, groupSources, totalSources } from '../lib/sources';
import type { AnswerSegment, AnswerSource, ChatTurn, HistoryEntry } from '../types';

/** Split accumulated agent text into (displayable text, handoff flag),
 *  stripping the sentinel token and any trailing whitespace. */
function stripSentinel(text: string): { display: string; handoff: boolean } {
  const idx = text.indexOf(HANDOFF_SENTINEL);
  if (idx === -1) return { display: text, handoff: false };
  return { display: text.slice(0, idx).replace(/\s+$/, ''), handoff: true };
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

/** Turn a completed turn into the {role,content} pairs Agent Studio expects
 *  as prior history. Turns with no successful segment are skipped entirely
 *  (an unanswered question shouldn't be replayed as context). */
function turnToHistory(t: ChatTurn): HistoryEntry[] {
  const answered = t.segments.filter((s) => s.status === 'success' && s.text.trim());
  if (answered.length === 0) return [];
  const combined = answered.map((s) => s.text).join('\n\n');
  return [
    { role: 'user', content: t.query },
    { role: 'assistant', content: combined },
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

export interface UseChatResult {
  turns: ChatTurn[];
  isStreaming: boolean;
  sendMessage: (query: string) => Promise<void>;
  retryTurn: (turnId: string) => Promise<void>;
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
      prev.map((t) => (t.id === turnId ? { ...t, segments: [...t.segments, segment], handoff: true } : t)),
    );
  }, []);

  /** Run one full turn (Generic, then Technical if the sentinel fires).
   *  `priorHistory` is the conversation context as of just before this turn. */
  const runTurn = useCallback(
    async (turnId: string, query: string, priorHistory: HistoryEntry[]) => {
      setIsStreaming(true);
      try {
        // --- Generic leg ---
        let genericResult;
        try {
          genericResult = await callCompletions(
            getGenericConfig(),
            { history: priorHistory, query },
            (accumulated) => {
              const { display } = stripSentinel(accumulated);
              updateSegment(turnId, 0, { status: 'streaming', text: display });
            },
          );
        } catch (err) {
          updateSegment(turnId, 0, { status: 'error', error: toErrorMessage(err) });
          return;
        }

        const { display: genericText, handoff } = stripSentinel(genericResult.content);
        const genericSources = normalizeSources(genericResult.hits);

        if (genericResult.error) {
          updateSegment(turnId, 0, {
            status: 'error',
            text: genericText,
            sources: genericSources,
            searchCount: totalSources(groupSources(genericSources)),
            error: genericResult.error,
          });
          return;
        }

        updateSegment(turnId, 0, {
          status: 'success',
          text: genericText,
          sources: genericSources,
          searchCount: totalSources(groupSources(genericSources)),
        });

        if (!handoff) return;

        // --- Handoff to Technical ---
        const technicalSegment: AnswerSegment = {
          agent: 'technical',
          status: 'loading',
          text: '',
          sources: [],
          searchCount: 0,
        };
        appendSegment(turnId, technicalSegment);

        const technicalHistory: HistoryEntry[] = [
          ...priorHistory,
          { role: 'user', content: query },
          { role: 'assistant', content: genericText },
        ];

        let technicalResult;
        try {
          technicalResult = await callCompletions(
            getTechnicalConfig(),
            { history: technicalHistory, query },
            (accumulated) => {
              updateSegment(turnId, 1, { status: 'streaming', text: accumulated });
            },
          );
        } catch (err) {
          updateSegment(turnId, 1, { status: 'error', error: toErrorMessage(err) });
          return;
        }

        const technicalSources = normalizeSources(technicalResult.hits);
        if (technicalResult.error) {
          updateSegment(turnId, 1, {
            status: 'error',
            text: technicalResult.content,
            sources: technicalSources,
            searchCount: totalSources(groupSources(technicalSources)),
            error: technicalResult.error,
          });
          return;
        }

        updateSegment(turnId, 1, {
          status: 'success',
          text: technicalResult.content,
          sources: technicalSources,
          searchCount: totalSources(groupSources(technicalSources)),
        });
      } finally {
        setIsStreaming(false);
      }
    },
    [appendSegment, updateSegment],
  );

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
                segments: [{ agent: 'generic', status: 'loading', text: '', sources: [], searchCount: 0 }],
              }
            : t,
        ),
      );

      await runTurn(turnId, turn.query, priorHistory);
    },
    [isStreaming, runTurn],
  );

  return { turns, isStreaming, sendMessage, retryTurn };
}
