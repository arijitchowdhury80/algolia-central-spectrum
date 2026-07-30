/**
 * useCostRecording — records this answer's cost into the session-wide
 * costStore as soon as it's known (spike plan §6). Two independent sources,
 * recorded as they each become available:
 *   - the agent's ESTIMATED cost, the moment the segment finishes streaming
 *     (costEstimate.ts — text-length heuristic, since Agent Studio's wire
 *     protocol carries no real token counts at all);
 *   - the judge's EXACT cost, once its verdict resolves with a `usage` block
 *     (only present on a judge deployment that has Phase 3's cost tracking —
 *     absent on an older deployment, in which case nothing judge-side is
 *     ever recorded for this answer).
 * costStore.recordCost is itself de-duped by id, so effects re-firing on an
 * unrelated re-render never double-count.
 */
import { useEffect } from 'react';
import { estimateAgentCost } from '../lib/costEstimate';
import { recordCost } from '../lib/costStore';
import type { JudgeVerdict } from '../lib/judgeClient';
import type { AnswerSegment } from '../types';

const BODY_FIELD_PRIORITY = ['body', 'content', 'text', 'snippet', 'summary', 'description'] as const;

/** Mirrors judgeClient.ts's pickHitText — the richest-first body field, so the
 *  agent cost estimate's "input" side reflects the same text the judge itself
 *  scores against, not just titles. */
function sourcesTextFromHits(hits: Record<string, unknown>[] | undefined): string[] {
  if (!hits) return [];
  return hits.map((hit) => {
    for (const key of BODY_FIELD_PRIORITY) {
      const v = hit[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    const title = hit.title;
    return typeof title === 'string' ? title : '';
  });
}

export function useCostRecording(
  turnId: string,
  segment: AnswerSegment,
  question: string,
  verdict?: JudgeVerdict,
): void {
  const hasText = !!segment.text.trim();

  useEffect(() => {
    if (segment.status !== 'success' || !hasText) return;
    const est = estimateAgentCost({
      question,
      answer: segment.text,
      sourcesText: sourcesTextFromHits(segment.rawHits),
    });
    recordCost({
      id: `${turnId}:${segment.agent}:agent`,
      turnId,
      agent: segment.agent,
      kind: 'agent',
      method: 'ESTIMATED',
      model: est.model,
      inputTokens: est.estimatedInputTokens,
      outputTokens: est.estimatedOutputTokens,
      costUsd: est.estimatedCostUsd,
    });
    // segment.text/rawHits are read once the answer is done (status flips to
    // 'success' exactly once); re-running on later unrelated renders is a
    // harmless no-op via costStore's id dedupe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId, segment.agent, segment.status, hasText]);

  useEffect(() => {
    if (!verdict || verdict.error || !verdict.usage) return;
    recordCost({
      id: `${turnId}:${segment.agent}:judge`,
      turnId,
      agent: segment.agent,
      kind: 'judge',
      method: 'EXACT',
      model: verdict.usage.calls[0]?.model ?? 'unknown',
      inputTokens: verdict.usage.totalInputTokens,
      outputTokens: verdict.usage.totalOutputTokens,
      costUsd: verdict.usage.estimatedCostUsd,
    });
  }, [turnId, segment.agent, verdict]);
}
