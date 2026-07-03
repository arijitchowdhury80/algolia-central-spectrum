import { useEffect, useState } from 'react';
import type { JudgeDims, JudgePerJudge, JudgeRole, JudgeVerdict } from '../lib/judgeClient';

/**
 * JudgeDrawer — the full grounding-judge breakdown for ONE answer, opened by
 * clicking that answer's ConfidenceChip. Right-side slide-over.
 *
 * Surfaces the whole mechanism the user built: the composite "Confidence"
 * (= mean of 3 blind judges, capped by the grounding hard-floor), the 4 rubric
 * dimensions (each a mean of the 3 judges), the per-judge scores (Skeptic /
 * Referee / Advocate) with their lenses, the flagged claims, and the rationale.
 *
 * The judge itself runs on the hosted backend (VITE_JUDGE_URL →
 * judge.contentengagement.info); this component only renders the verdict.
 */
export interface JudgeDrawerProps {
  open: boolean;
  verdict: JudgeVerdict | null;
  question: string;
  onClose: () => void;
}

/** Friendly labels for known dimension ids. The backend rubric may evolve
 *  (currently grounding / confidence / breadthDepth); unknown ids fall back to
 *  their raw key so nothing is ever dropped or crashes. */
const DIM_LABELS: Record<string, string> = {
  grounding: 'Grounding',
  confidence: 'Confidence',
  breadthDepth: 'Breadth & depth',
  coverage: 'Coverage',
  depth: 'Depth',
  relevance: 'Relevance',
};
const DIM_PREFERRED = ['grounding', 'confidence', 'breadthDepth', 'coverage', 'depth', 'relevance'];

/** Order the dims the backend actually sent: preferred ids first, then any extras. */
function orderedDims(dims: JudgeDims): Array<{ key: string; label: string; score: number }> {
  const out: Array<{ key: string; label: string; score: number }> = [];
  const seen = new Set<string>();
  for (const k of DIM_PREFERRED) {
    if (k in dims && Number.isFinite(dims[k])) {
      out.push({ key: k, label: DIM_LABELS[k] ?? k, score: dims[k] });
      seen.add(k);
    }
  }
  for (const k of Object.keys(dims)) {
    if (!seen.has(k) && Number.isFinite(dims[k])) out.push({ key: k, label: DIM_LABELS[k] ?? k, score: dims[k] });
  }
  return out;
}

const JUDGE_ORDER: JudgeRole[] = ['skeptic', 'referee', 'advocate'];
const JUDGE_LABEL: Record<JudgeRole, string> = { skeptic: 'Skeptic', referee: 'Referee', advocate: 'Advocate' };
const JUDGE_LENS: Record<JudgeRole, string> = {
  skeptic: 'Adversarial — assumes claims wrong until sourced. Only this judge can trip the grounding floor.',
  referee: 'Neutral — applies the rubric literally.',
  advocate: 'Generous — rewards genuine depth, never excuses fabrication.',
};

type Tone = 'positive' | 'notice' | 'negative';
function scoreTone(score: number): Tone {
  if (score >= 7.5) return 'positive';
  if (score >= 5) return 'notice';
  return 'negative';
}
const TEXT_TONE: Record<Tone, string> = {
  positive: 'text-ac-positive',
  notice: 'text-ac-notice',
  negative: 'text-ac-negative',
};
const BAR_TONE: Record<Tone, string> = {
  positive: 'bg-ac-positive',
  notice: 'bg-ac-notice',
  negative: 'bg-ac-negative',
};

function DimBar({ label, score }: { label: string; score: number }) {
  const tone = scoreTone(score);
  const pct = Math.max(0, Math.min(100, (score / 10) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-ac-xs">
        <span className="font-ac-medium text-ac-text-secondary">{label}</span>
        <span className={TEXT_TONE[tone]}>
          <span className="font-ac-bold">{score.toFixed(1)}</span>
          <span className="text-ac-text-muted">/10</span>
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-ac-full bg-ac-surface-2"
        role="img"
        aria-label={`${label}: ${score.toFixed(1)} out of 10`}
      >
        <div className={`h-full rounded-ac-full ${BAR_TONE[tone]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function GateBadge({ gateTripped, borderline }: { gateTripped: boolean; borderline: boolean }) {
  if (gateTripped) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-ac-sm border border-ac-negative bg-ac-negative-bg px-2.5 py-1 text-ac-xs font-ac-bold text-ac-negative">
        <span aria-hidden="true">✗</span>
        <span>UNSUPPORTED</span>
      </span>
    );
  }
  if (borderline) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-ac-sm border border-ac-notice bg-ac-notice-bg px-2.5 py-1 text-ac-xs font-ac-bold text-ac-notice">
        <span aria-hidden="true">⚠</span>
        <span>BORDERLINE</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-ac-sm border border-ac-positive bg-ac-positive-bg px-2.5 py-1 text-ac-xs font-ac-bold text-ac-positive">
      <span aria-hidden="true">✓</span>
      <span>GROUNDED</span>
    </span>
  );
}

/** One judge as a collapsed-by-default accordion: header shows name + score,
 *  expanding reveals its lens + written note. */
function JudgeAccordion({ j }: { j: JudgePerJudge }) {
  const [open, setOpen] = useState(false);
  const tone = scoreTone(j.score);
  return (
    <li className="overflow-hidden rounded-ac-sm border border-ac-border bg-ac-surface-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-ac-surface-hover"
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-ac-text-muted">{open ? '▾' : '▸'}</span>
          <span className="text-ac-sm font-ac-bold text-ac-text">{JUDGE_LABEL[j.role]}</span>
        </span>
        <span className={`text-ac-sm font-ac-bold ${TEXT_TONE[tone]}`}>{j.score.toFixed(1)}/10</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-ac-border px-3 py-2">
          <p className="m-0 text-[11px] text-ac-text-muted">{JUDGE_LENS[j.role]}</p>
          {j.note && <p className="m-0 text-ac-xs text-ac-text-secondary">{j.note}</p>}
        </div>
      )}
    </li>
  );
}

function PerJudgeList({ perJudge }: { perJudge: JudgePerJudge[] }) {
  const ordered = JUDGE_ORDER.map((role) => perJudge.find((j) => j.role === role)).filter(
    (j): j is JudgePerJudge => Boolean(j),
  );
  if (ordered.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
        The panel ({ordered.length} judges)
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {ordered.map((j) => (
          <JudgeAccordion key={j.role} j={j} />
        ))}
      </ul>
    </div>
  );
}

export function JudgeDrawer({ open, verdict, question, onClose }: JudgeDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !verdict) return null;

  const composite = verdict.composite;
  const compTone = verdict.gateTripped ? 'negative' : scoreTone(composite);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Grounding judge breakdown">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close judge breakdown"
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-ac-border bg-ac-surface shadow-ac-3">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-ac-border bg-ac-surface px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 text-ac-base font-ac-bold text-ac-text">Grounding verdict</h2>
            <p className="m-0 line-clamp-2 text-ac-xs text-ac-text-muted">“{question}”</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-ac-full border border-ac-border px-2 py-0.5 text-ac-sm text-ac-text-secondary transition-colors hover:border-ac-accent hover:bg-ac-surface-hover"
          >
            ✕
          </button>
        </div>

        {verdict.error ? (
          <div className="m-5 rounded-ac-sm border border-ac-negative bg-ac-negative-bg px-3 py-2.5 text-ac-sm text-ac-negative">
            <p className="m-0 font-ac-medium">Judge unavailable</p>
            <p className="m-0 mt-1 text-ac-xs">{verdict.error}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-5 py-5">
            {/* Composite + gate */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-ac-xs font-ac-medium text-ac-text-muted">
                  {verdict.gateTripped ? 'Overall · capped by grounding floor' : 'Overall · mean of 3 judges'}
                </span>
                <span className={`text-ac-2xl font-ac-bold ${TEXT_TONE[compTone]}`}>
                  {composite.toFixed(1)}
                  <span className="text-ac-sm font-ac-medium text-ac-text-muted">/10</span>
                </span>
                {verdict.gateTripped && (
                  <span className="text-[11px] text-ac-text-muted">
                    Panel mean was {verdict.preGateScore.toFixed(1)} — floored to {composite.toFixed(1)} because grounding wasn’t verified.
                  </span>
                )}
              </div>
              <GateBadge gateTripped={verdict.gateTripped} borderline={verdict.borderline} />
            </div>

            <p className="m-0 rounded-ac-sm bg-ac-surface-2 px-3 py-2 text-[11px] text-ac-text-muted">
              {verdict.gateTripped ? (
                <>
                  The dimension bars and per-judge scores below are the panel’s <strong>actual</strong> marks
                  (mean {verdict.preGateScore.toFixed(1)}). The <strong>{composite.toFixed(1)}</strong> above is a
                  hard-floor cap: the grounding gate trips independently of the numbers, so the answer reads
                  UNSUPPORTED even when the judges scored it well.
                </>
              ) : (
                <>
                  3 blind judges (Skeptic · Referee · Advocate) score each dimension 1–10. The composite is
                  their mean; a verified grounding violation caps it via the hard floor — so a fluent-but-unsourced
                  answer can’t read green.
                </>
              )}
            </p>

            {/* Dimensions */}
            <div className="flex flex-col gap-3">
              <h3 className="m-0 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
                Dimensions · mean of 3
              </h3>
              {orderedDims(verdict.dims).map((d) => (
                <DimBar key={d.key} label={d.label} score={d.score} />
              ))}
            </div>

            {/* Per-judge */}
            <PerJudgeList perJudge={verdict.perJudge} />

            {/* Flagged claims */}
            {verdict.flaggedClaims.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="m-0 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
                  Flagged claims ({verdict.flaggedClaims.length})
                </h3>
                {verdict.flaggedClaims.map((c, i) => (
                  <div key={i} className="rounded-ac-sm border border-ac-border bg-ac-surface-2 px-3 py-2">
                    <p className="m-0 text-ac-sm text-ac-text">“{c.claim}”</p>
                    <p className="m-0 mt-1 text-ac-xs text-ac-text-secondary">
                      {c.reason}{' '}
                      <span className="text-ac-text-muted">
                        · {Math.round(Math.min(1, Math.max(0, c.certainty ?? c.confidence ?? 0)) * 100)}% certainty
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            )}

            {verdict.gateTripped && verdict.flaggedClaims.length === 0 && (
              <div className="rounded-ac-sm border border-ac-notice bg-ac-notice-bg px-3 py-2 text-ac-xs text-ac-notice">
                Grounding floor tripped without a specific flagged claim — the Skeptic couldn’t map part of the
                answer to the provided sources (often thin/partial sources rather than a clear fabrication).
              </div>
            )}

            {/* Rationale */}
            {verdict.rationale && (
              <div className="rounded-ac-sm border border-ac-border bg-ac-surface-2 px-3 py-2.5">
                <h3 className="m-0 mb-1 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
                  Synthesis rationale
                </h3>
                <p className="m-0 text-ac-sm text-ac-text-secondary">{verdict.rationale}</p>
              </div>
            )}

            <p className="m-0 text-[10px] text-ac-text-muted">
              Live judging is indicative (1 round, fast model). Run the batch harness for the authoritative score.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
