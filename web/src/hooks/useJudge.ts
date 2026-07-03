/**
 * useJudge — auto-fires the live judge once an assistant answer finishes
 * streaming, and exposes its verdict.
 *
 * Driven by a single `JudgeTarget` (the "current answer to judge") rather
 * than the whole turn list, so the SAME hook instance can track a moving
 * target: App.tsx recomputes "the most recent assistant answer" on every
 * render (Generic while it's the only segment, then Technical once the
 * handoff sentinel appends a second segment) and passes it down. Each
 * distinct `id` (`${turnId}:${agent}`) fires and caches independently, so
 * both the Generic and the Technical answer in a handed-off turn each get
 * judged exactly once — "reflects the most recent" just means the caller
 * reads whichever target is current.
 *
 * Memoization: a ref-backed cache keyed by `id` guarantees a re-render
 * (e.g. streaming text ticking in on a LATER turn, or React re-rendering
 * this component for unrelated reasons) never re-fires a judge call for an
 * id that's already judging/done/error.
 */
import { useEffect, useRef, useState } from 'react';
import { judgeAnswer, type JudgeVerdict } from '../lib/judgeClient';
import type { AnswerSegment } from '../types';

export type JudgeStatus = 'idle' | 'judging' | 'done' | 'error';

export interface UseJudgeResult {
  status: JudgeStatus;
  verdict?: JudgeVerdict;
}

/** The answer to judge: a stable identity + the question it answered + its
 *  (possibly still-streaming) segment. `null` = nothing to judge yet. */
export interface JudgeTarget {
  /** Stable per-answer key, e.g. `${turnId}:${segment.agent}`. */
  id: string;
  question: string;
  segment: AnswerSegment;
}

interface CacheEntry {
  status: JudgeStatus;
  verdict?: JudgeVerdict;
}

export function useJudge(target: JudgeTarget | null): UseJudgeResult {
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  // Bump to force a re-render when a cache entry mutates (the cache itself
  // lives in a ref so effect re-runs from prop churn don't reset it).
  const [, setTick] = useState(0);

  const id = target?.id;
  const status = target?.segment.status;
  const text = target?.segment.text;

  useEffect(() => {
    if (!target || !id) return;
    if (status !== 'success' || !text?.trim()) return; // not finished yet
    if (cacheRef.current.has(id)) return; // already fired/cached for this answer

    cacheRef.current.set(id, { status: 'judging' });
    setTick((n) => n + 1);

    const question = target.question;
    const answer = target.segment.text;
    const hits = target.segment.rawHits ?? [];

    judgeAnswer({ question, answer, hits, panelId: target.segment.agent })
      .then((verdict) => {
        cacheRef.current.set(id, { status: verdict.error ? 'error' : 'done', verdict });
        setTick((n) => n + 1);
      })
      .catch((err: unknown) => {
        // judgeAnswer is designed to never reject, but guard anyway so a
        // judge outage can never surface as an unhandled rejection.
        cacheRef.current.set(id, {
          status: 'error',
          verdict: {
            panelId: target.segment.agent,
            dims: { grounding: 0, coverage: 0, depth: 0, relevance: 0 },
            synthesizedScore: 0,
            composite: 0,
            preGateScore: 0,
            gateTripped: false,
            borderline: false,
            flaggedClaims: [],
            perJudge: [],
            rationale: '',
            error: err instanceof Error ? err.message : String(err),
          },
        });
        setTick((n) => n + 1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status, text]);

  if (!id) return { status: 'idle' };
  const cached = cacheRef.current.get(id);
  if (!cached) return { status: 'idle' };
  return cached;
}
