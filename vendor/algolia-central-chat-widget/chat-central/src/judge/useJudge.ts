/**
 * useJudge — auto-fires the live judge once an assistant answer finishes
 * streaming, and exposes its verdict.
 *
 * Driven by a single `JudgeTarget` rather than the whole turn list, so one
 * hook instance can track a moving target. Each distinct `id` fires and caches
 * independently, so both segments in a handed-off turn each get judged once.
 * A ref-backed cache guarantees a re-render never re-fires a call for an id
 * that's already judging/done/error.
 *
 * Judge config (mode, url, apiKey, agentId) is read from the IS renderState
 * via `useWidgetState()` — the chatConfidence leaf widget publishes it into
 * `renderState.chatConfidence`. When no chatConfidence widget is registered,
 * `judgeAnswer` falls back to the global env singleton (`getRuntimeEnv()`) for
 * backward compat with attribute-based judge config on `<algolia-chat>`.
 *
 * TWO PHASES
 * ----------
 * A verdict has two halves with wildly different costs, measured on a real
 * panel: the deterministic grounding check takes ~8ms, the three-judge LLM
 * panel takes 18-32s per judge. The badge displays ONLY the grounding half. So
 * this hook asks for that half first (`/api/ground`) and publishes it the
 * instant it lands, then runs the full judge and replaces the verdict when it
 * arrives — the badge is correct immediately, and the drawer's composite and
 * per-judge detail fill in behind it.
 *
 * Both halves compute grounding with the same pure function on the backend, so
 * the fast verdict cannot disagree with the full one. If the fast route is
 * unavailable (an older judge deployment 404s), `groundAnswer` returns null and
 * this degrades silently to the single-call behaviour it had before.
 */
import { useEffect, useRef, useState } from 'react';
import { judgeAnswer, groundAnswer, type JudgeRuntimeConfig } from './hostedJudgeClient';
import { useWidgetState } from '../chat/widgetContext';
import type { JudgeVerdict } from './types';
import type { AnswerSegment } from '../chat/types';
import type { ChatConfidenceDescriptor } from '../connectChatConfidence';

export type JudgeStatus = 'idle' | 'judging' | 'done' | 'error';

export interface UseJudgeResult {
  status: JudgeStatus;
  verdict?: JudgeVerdict;
}

/** The answer to judge: a stable identity + the question it answered + its segment. */
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

function toJudgeConfig(
  descriptor: ChatConfidenceDescriptor | null,
): JudgeRuntimeConfig | undefined {
  if (!descriptor) return undefined;
  return {
    mode: descriptor.mode,
    url: descriptor.url,
    apiKey: descriptor.apiKey,
    agents: descriptor.agents,
  };
}

export function useJudge(target: JudgeTarget | null): UseJudgeResult {
  const { confidence } = useWidgetState();
  const confidenceRef = useRef(confidence);
  // Keep the ref up to date after every render so async judge callbacks always
  // read the latest confidence config without being listed as effect deps.
  useEffect(() => {
    confidenceRef.current = confidence;
  });

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const [, setTick] = useState(0);

  const id = target?.id;
  const status = target?.segment.status;
  const text = target?.segment.text;

  useEffect(() => {
    if (!target || !id) return;
    if (status !== 'success' || !text?.trim()) return;
    if (cacheRef.current.has(id)) return;

    cacheRef.current.set(id, { status: 'judging' });
    setTick((n) => n + 1);

    const question = target.question;
    const answer = target.segment.text;
    const hits = target.segment.rawHits ?? [];
    const judgeConfig = toJudgeConfig(confidenceRef.current);

    const input = { question, answer, hits, panelId: target.segment.agent };

    /** Publish a verdict to the cache, the UI, and any host-page badge. */
    const publish = (verdict: JudgeVerdict, done: boolean): void => {
      cacheRef.current.set(id, {
        status: verdict.error ? 'error' : done ? 'done' : 'judging',
        verdict,
      });
      setTick((n) => n + 1);

      // Notify standalone <algolia-confidence-badge> elements rendered by
      // chatConfidenceWidget({ container }) outside the chat shadow root.
      if (!verdict.error) {
        try {
          document.dispatchEvent(
            new CustomEvent('algolia-verdict', {
              detail: { verdict, question },
              bubbles: false,
            }),
          );
        } catch {
          // Guard against SSR / non-browser environments.
        }
      }
    };

    // Phase 1 — grounding only (~8ms server-side). Best effort: a null result
    // means the backend has no fast route, and phase 2 alone then behaves
    // exactly as this hook did before. Status stays `judging` so the drawer can
    // show the panel as still loading while the badge is already correct.
    void groundAnswer(input, fetch, judgeConfig).then((fast) => {
      // Never overwrite a full verdict that won the race.
      const current = cacheRef.current.get(id);
      if (fast && !current?.verdict) publish(fast, false);
    });

    // Phase 2 — the full three-judge panel. Always replaces the fast verdict.
    judgeAnswer(input, fetch, judgeConfig)
      .then((verdict) => {
        publish(verdict, true);
      })
      .catch((err: unknown) => {
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
  // Reading the ref during render is intentional: cacheRef backs the verdict
  // cache that is only written in effects/async callbacks, never mid-render.
  // setTick() in those callbacks triggers the re-render that reads this.
  // eslint-disable-next-line react-hooks/refs
  const cached = cacheRef.current.get(id);
  if (!cached) return { status: 'idle' };
  return cached;
}
