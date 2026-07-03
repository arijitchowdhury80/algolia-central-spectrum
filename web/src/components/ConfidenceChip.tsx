import type { JudgeVerdict } from '../lib/judgeClient';

/**
 * ConfidenceChip — the per-answer **Confidence** surface (ported from AC2,
 * restyled to the ACS design system).
 *
 * The composite judge score (0–10) shown ON each answer card. It fills in
 * asynchronously: the answer renders first, the 3-judge panel resolves a few
 * seconds later, so the chip starts in a "scoring…" state and then shows the
 * number. Clicking a scored chip opens the JudgeDrawer for THAT answer (the full
 * 4-dimension + 3-judge breakdown). When the grounding gate trips, the chip
 * carries a "⚠ N flagged" tail and forces a weak tone — a high-but-ungrounded
 * answer never reads green.
 */
export interface ConfidenceChipProps {
  /** The answer's judge verdict, once it resolves. Undefined while scoring. */
  verdict?: JudgeVerdict;
  /** True while the judge is running for this answer (shows the scoring state). */
  scoring?: boolean;
  /** Click a scored chip → open the judge drawer. Omit to render non-clickable. */
  onOpenJudge?: () => void;
}

/** Gate-aware tone: a tripped grounding floor is ALWAYS weak, regardless of the
 *  composite number (a fabricated-but-fluent answer must never read green). */
function chipTone(v: JudgeVerdict): 'positive' | 'notice' | 'negative' {
  if (v.gateTripped) return 'negative';
  if (v.composite >= 7.5) return 'positive';
  if (v.composite >= 5) return 'notice';
  return 'negative';
}

const TONE_CLS: Record<'positive' | 'notice' | 'negative', string> = {
  positive: 'border-ac-positive bg-ac-positive-bg text-ac-positive hover:shadow-ac-1',
  notice: 'border-ac-notice bg-ac-notice-bg text-ac-notice hover:shadow-ac-1',
  negative: 'border-ac-negative bg-ac-negative-bg text-ac-negative hover:shadow-ac-1',
};

export function ConfidenceChip({ verdict, scoring = false, onOpenJudge }: ConfidenceChipProps) {
  // ── Scoring (no verdict yet) — quiet, non-interactive placeholder. ──────────
  if (!verdict || verdict.error) {
    if (!scoring) return null;
    return (
      <span
        className="inline-flex w-fit items-center gap-1.5 rounded-ac-full border border-ac-border bg-ac-surface-2 px-3 py-1 text-ac-xs font-ac-medium text-ac-text-muted"
        aria-live="polite"
        aria-label="Confidence score in progress"
      >
        <span aria-hidden="true">⚖</span>
        <span>Confidence</span>
        <span className="motion-safe:animate-pulse">· scoring…</span>
      </span>
    );
  }

  // ── Scored — the clickable composite. ───────────────────────────────────────
  const tone = chipTone(verdict);
  const flagged = verdict.flaggedClaims.length;
  const title = verdict.gateTripped
    ? `Confidence ${verdict.composite.toFixed(1)}/10 — grounding floor tripped (${flagged} flagged). Click for the full breakdown.`
    : `Confidence ${verdict.composite.toFixed(1)}/10 — click for the 3-judge breakdown.`;

  return (
    <button
      type="button"
      className={`inline-flex w-fit items-center gap-1.5 rounded-ac-full border px-3 py-1 text-ac-xs font-ac-medium transition-colors duration-ac-fast ease-ac-ease disabled:cursor-default ${TONE_CLS[tone]}`}
      onClick={onOpenJudge}
      disabled={!onOpenJudge}
      title={title}
      aria-label={`Confidence ${verdict.composite.toFixed(1)} out of 10. Open the judge breakdown.`}
    >
      <span aria-hidden="true">⚖</span>
      <span>Confidence</span>
      <span className="font-ac-bold">{verdict.composite.toFixed(1)}</span>
      <span className="opacity-70">/10</span>
      {verdict.gateTripped && flagged > 0 && (
        <span className="ml-0.5 border-l border-current pl-1.5">⚠ {flagged} flagged</span>
      )}
      <span aria-hidden="true" className="opacity-60">›</span>
    </button>
  );
}
