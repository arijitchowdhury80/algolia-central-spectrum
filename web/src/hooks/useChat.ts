/**
 * useChat — the client baton orchestration (the app's core feature).
 *
 * Ported from _legacy_plaincss/src/hooks/useChat.ts. Owns the turn list and
 * drives the Generic -> [sentinel? -> Technical] flow:
 *   1. Call Generic with running history. Stream text live.
 *   2. Watch the accumulated Generic text for HANDOFF_SENTINEL. If present,
 *      strip it, mark the turn as a handoff, and call Technical with
 *      history = [...priorHistory, user turn, Generic's stripped answer].
 *   3. Persist each turn's final assistant content (Generic, +Technical if
 *      handed off) into `turns` so the NEXT call's history is correct.
 *
 * Agent IDs now come from the active instance config (not hardcoded) — see
 * lib/agents.ts header for why.
 */
import { useState, useCallback, useRef } from 'react';
import { callCompletions } from '../lib/agentStudio';
import { getAgentConfig, HANDOFF_SENTINEL } from '../lib/agents';
import { normalizeHit, groupSources, totalSources } from '../lib/sources';
import { activeInstance } from '../config/active';
import type { AnswerSegment, AnswerSource, ChatTurn, HistoryEntry } from '../types';

const FOLLOWUP_RE = /\[\[FOLLOWUP:\s*([^\]]+?)\]\]/i;

/** Parse accumulated agent text into displayable text + control signals,
 *  stripping the machine-readable tokens: `[[HANDOFF:technical]]` (deep-dive
 *  offer) and `[[FOLLOWUP: <question>]]` (discovery card). */
function parseAgentText(text: string): { display: string; handoff: boolean; followUp?: string } {
  const fu = text.match(FOLLOWUP_RE);
  const followUp = fu ? fu[1].trim() : undefined;
  let display = text.replace(FOLLOWUP_RE, '');
  const idx = display.indexOf(HANDOFF_SENTINEL);
  const handoff = idx !== -1;
  if (handoff) display = display.slice(0, idx);
  return { display: display.replace(/\s+$/, ''), handoff, followUp };
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
            getAgentConfig(activeInstance.agents.generic.id),
            { history: priorHistory, query },
            (accumulated) => {
              const { display } = parseAgentText(accumulated);
              updateSegment(turnId, 0, { status: 'streaming', text: display });
            },
          );
        } catch (err) {
          updateSegment(turnId, 0, { status: 'error', error: toErrorMessage(err) });
          return;
        }

        const { display: genericText, handoff, followUp } = parseAgentText(genericResult.content);
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

        // Deep-dive is HUMAN-GATED: on the handoff sentinel we only OFFER the
        // specialist (never auto-run). Also stash the agent's suggested
        // follow-up question for the discovery card. One state update for both.
        setTurns((prev) =>
          prev.map((t) => (t.id === turnId ? { ...t, deepDiveOffered: handoff, followUp } : t)),
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

        const technicalHistory: HistoryEntry[] = [
          ...priorHistory,
          { role: 'user', content: query },
          { role: 'assistant', content: genericText },
        ];

        let technicalResult;
        try {
          technicalResult = await callCompletions(
            getAgentConfig(activeInstance.agents.technical.id),
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
            rawHits: technicalResult.hits,
          });
          return;
        }

        updateSegment(turnId, 1, {
          status: 'success',
          text: technicalResult.content,
          sources: technicalSources,
          searchCount: totalSources(groupSources(technicalSources)),
          rawHits: technicalResult.hits,
        });
      } finally {
        setIsStreaming(false);
      }
    },
    [appendSegment, updateSegment],
  );

  /** User accepted the deep-dive offer → run the specialist leg. */
  const runDeepDive = useCallback(
    async (turnId: string) => {
      if (isStreaming) return;
      const turn = turnsRef.current.find((t) => t.id === turnId);
      if (!turn || !turn.deepDiveOffered || turn.handoff) return;
      const genericText = turn.segments[0]?.text ?? '';
      const priorHistory = historyBefore(turnsRef.current, turnId);
      await runTechnicalLeg(turnId, turn.query, priorHistory, genericText);
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
