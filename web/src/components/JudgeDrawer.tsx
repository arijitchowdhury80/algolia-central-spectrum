import { useEffect, useState } from 'react';
import type { JudgeDims, JudgePerJudge, JudgeRole, JudgeVerdict } from '../lib/judgeClient';

/**
 * JudgeDrawer — the full grounding-judge breakdown for ONE answer, opened by
 * clicking that answer's ConfidenceChip. Right-side slide-over.
 *
 * Surfaces the whole mechanism the user built: the composite "Confidence"
 * (= mean of 3 blind judges, capped by the corroboration gate), the rubric
 * dimension(s) (Phase 2 rebuild: a single Usefulness dim — grounding is now
 * purely the gate, not a scored number), the per-judge scores (Skeptic /
 * Referee / Advocate) with their lenses, the flagged claims (with their
 * traceable source excerpts, when the judge provided one), and the rationale.
 *
 * The judge runs on `lab/server` (VITE_JUDGE_URL, default
 * http://localhost:8788 — no hosted deployment exists yet, see judgeClient.ts
 * header). Dims are read as a tolerant `Record<string,number>` so this
 * component renders sensibly against BOTH the new 1-dim (`usefulness`) shape
 * and the old 4-dim (`grounding`/`coverage`/`depth`/`relevance`) shape from a
 * pre-Phase-2 fixture or judge — unknown ids fall back to their raw key so
 * nothing is ever dropped or crashes.
 */
export interface JudgeDrawerProps {
  open: boolean;
  verdict: JudgeVerdict | null;
  question: string;
  onClose: () => void;
}

/** Friendly labels for known dimension ids — current rubric first
 *  (`usefulness`, Phase 2), then the retired 4-dim ids so an old fixture or
 *  judge response still renders with real labels instead of raw keys. */
const DIM_LABELS: Record<string, string> = {
  usefulness: 'Usefulness',
  grounding: 'Grounding',
  confidence: 'Confidence',
  breadthDepth: 'Breadth & depth',
  coverage: 'Coverage',
  depth: 'Depth',
  relevance: 'Relevance',
};
const DIM_PREFERRED = ['usefulness', 'grounding', 'confidence', 'breadthDepth', 'coverage', 'depth', 'relevance'];

/** Order the dims the backend actually sent: preferred ids first, then any extras.
 *  Exported for unit testing — the tolerant-Record contract (Phase 2 rebuild
 *  1-dim `usefulness` vs. the retired 4-dim shape) is the load-bearing part
 *  of this component and has no DOM to render against under this repo's
 *  Node-environment test setup. */
export function orderedDims(dims: JudgeDims): Array<{ key: string; label: string; score: number }> {
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

/**
 * The reproducible grounding result (2026-07-28) — a verbatim search for the
 * terms that cannot be paraphrased. This is the drawer's headline because it is
 * the only signal in here with measured precision (1.00) and zero variance.
 * Rendered only when the judge reports it; an older deployment gets nothing
 * rather than a guess.
 */
function DeterministicGrounding({ verdict }: { verdict: JudgeVerdict }) {
  if (verdict.grounded === undefined) return null;
  const unsupported = verdict.unsupportedTerms ?? [];
  const checked = verdict.termsChecked ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
        Grounding check · verbatim, reproducible
      </h3>
      {unsupported.length > 0 ? (
        <div className="rounded-ac-sm border border-ac-negative bg-ac-negative-bg px-3 py-2">
          <p className="m-0 text-ac-sm font-ac-medium text-ac-negative">
            {unsupported.length} of {checked} checked term{checked === 1 ? '' : 's'} appear in no
            cited source
          </p>
          <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
            {unsupported.map((u) => (
              <li
                key={u.term}
                className="rounded-ac-sm bg-ac-surface px-1.5 py-0.5 font-mono text-[11px] text-ac-negative"
                title={u.kind}
              >
                {u.term}
              </li>
            ))}
          </ul>
        </div>
      ) : checked === 0 ? (
        <p className="m-0 rounded-ac-sm bg-ac-surface-2 px-3 py-2 text-ac-xs text-ac-text-muted">
          Nothing verbatim-checkable in this answer — no API names, identifiers, or figures. The
          check makes no claim about prose.
        </p>
      ) : (
        <p className="m-0 rounded-ac-sm border border-ac-positive bg-ac-positive-bg px-3 py-2 text-ac-xs text-ac-positive">
          All {checked} verbatim-checkable term{checked === 1 ? '' : 's'} located in the cited
          sources.
        </p>
      )}
      <p className="m-0 text-[10px] text-ac-text-muted">
        Searches the answer’s code identifiers, API names, and figures against the source text
        directly. Same answer, same verdict, every time — no model judgement involved.
      </p>
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
            {/* The reproducible verdict leads. */}
            <div className="flex items-center justify-between gap-3">
              <DeterministicGrounding verdict={verdict} />
              <GateBadge gateTripped={verdict.gateTripped} borderline={verdict.borderline} />
            </div>

            {/* The panel's quality read — deliberately demoted, with its
                limitation stated rather than implied. */}
            <div className="flex flex-col gap-1 border-t border-ac-border pt-4">
              <span className="text-ac-xs font-ac-medium text-ac-text-muted">
                Panel’s usefulness read · mean of 3 judges
              </span>
              <span className={`text-ac-xl font-ac-bold ${TEXT_TONE[compTone]}`}>
                {composite.toFixed(1)}
                <span className="text-ac-sm font-ac-medium text-ac-text-muted">/10</span>
              </span>
              <p className="m-0 rounded-ac-sm bg-ac-surface-2 px-3 py-2 text-[11px] text-ac-text-muted">
                This number is <strong>not calibrated against human judgement</strong> and is not
                reproducible run to run — treat it as a reading, not a measurement. It is shown here
                and deliberately kept off the answer chip. The grounding result above is the claim
                the product stands behind.
              </p>
            </div>

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

            {/* Flagged claims — corroborated (capping) + solo (borderline) clusters, with
                traceable excerpts when the judge provided one (spec §1c). */}
            {verdict.flaggedClaims.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="m-0 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
                  {verdict.groundingMode === 'deterministic' ? 'Advisory claim flags' : 'Flagged claims'}{' '}
                  ({verdict.flaggedClaims.length})
                </h3>
                {verdict.groundingMode === 'deterministic' && (
                  <p className="m-0 text-[10px] text-ac-text-muted">
                    Raised by the judge panel. These do <strong>not</strong> change the verdict above —
                    a model asked whether a claim is absent from the corpus guesses, and the guess is
                    not reproducible. They are shown because they catch real problems the verbatim
                    check cannot see (an unsupported claim made entirely in prose).
                  </p>
                )}
                {verdict.flaggedClaims.map((c, i) => {
                  const judgeCount = c.judgeIds?.length ?? 0;
                  const corroborated = judgeCount >= 2;
                  return (
                    <div key={i} className="rounded-ac-sm border border-ac-border bg-ac-surface-2 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="m-0 text-ac-sm text-ac-text">“{c.claim}”</p>
                        {judgeCount > 0 && (
                          <span
                            className={`shrink-0 rounded-ac-sm px-1.5 py-0.5 text-[10px] font-ac-bold ${
                              corroborated
                                ? 'bg-ac-negative-bg text-ac-negative'
                                : 'bg-ac-notice-bg text-ac-notice'
                            }`}
                          >
                            {judgeCount} judge{judgeCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <p className="m-0 mt-1 text-ac-xs text-ac-text-secondary">
                        {c.reason}{' '}
                        <span className="text-ac-text-muted">
                          · {Math.round(Math.min(1, Math.max(0, c.certainty ?? c.confidence ?? 0)) * 100)}% certainty
                        </span>
                      </p>
                      {c.excerpt && (
                        <div className="mt-1.5 rounded-ac-sm border-l-2 border-ac-border bg-ac-surface px-2 py-1">
                          <p className="m-0 text-[11px] italic text-ac-text-secondary">“{c.excerpt}”</p>
                          <p className="m-0 mt-0.5 text-[10px] text-ac-text-muted">
                            {c.sourceId ? `— ${c.sourceId}, ` : '— '}
                            {c.excerptVerified ? (
                              <span className="text-ac-positive">verified in source ✓</span>
                            ) : (
                              <span className="text-ac-notice">excerpt not confirmed in source ⚠</span>
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
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
