import { useState } from 'react';
import { useJudge, type JudgeTarget } from '../hooks/useJudge';
import type { JudgeDims, JudgeFlaggedClaim, JudgePerJudge, JudgeRole } from '../lib/judgeClient';
import { AgentBadge } from './AgentBadge';
import type { ChatTurn } from '../types';

export interface JudgePanelProps {
  turns: ChatTurn[];
}

/** The "most recent assistant answer" — the last segment of the last turn.
 *  As a turn progresses (Generic success -> Technical appended -> Technical
 *  success), this target's `id` changes, which is what lets useJudge fire a
 *  fresh judge call for each answer in turn (see useJudge.ts header). */
function latestTarget(turns: ChatTurn[]): JudgeTarget | null {
  const turn = turns[turns.length - 1];
  if (!turn) return null;
  const segment = turn.segments[turn.segments.length - 1];
  if (!segment) return null;
  return { id: `${turn.id}:${segment.agent}`, question: turn.query, segment };
}

const DIM_ORDER: Array<{ key: keyof JudgeDims; label: string }> = [
  { key: 'grounding', label: 'Grounding' },
  { key: 'coverage', label: 'Coverage' },
  { key: 'depth', label: 'Depth' },
  { key: 'relevance', label: 'Relevance' },
];

const JUDGE_ORDER: JudgeRole[] = ['skeptic', 'referee', 'advocate'];
const JUDGE_LABEL: Record<JudgeRole, string> = {
  skeptic: 'Skeptic',
  referee: 'Referee',
  advocate: 'Advocate',
};
const JUDGE_LENS: Record<JudgeRole, string> = {
  skeptic: 'Adversarial — assumes claims wrong until sourced.',
  referee: 'Neutral — applies the rubric literally.',
  advocate: 'Generous — rewards genuine depth, never excuses fabrication.',
};

/** score -> tone class suffix, shared by the composite, bars, and chips.
 *  Tone always pairs with text/an icon elsewhere — never color-only. */
function scoreTone(score: number): 'positive' | 'notice' | 'negative' {
  if (score >= 7.5) return 'positive';
  if (score >= 5) return 'notice';
  return 'negative';
}

function ToneText({ tone, children }: { tone: 'positive' | 'notice' | 'negative'; children: React.ReactNode }) {
  const cls =
    tone === 'positive' ? 'text-ac-positive' : tone === 'notice' ? 'text-ac-notice' : 'text-ac-negative';
  return <span className={cls}>{children}</span>;
}

function DimBar({ label, score }: { label: string; score: number }) {
  const tone = scoreTone(score);
  const pct = Math.max(0, Math.min(100, (score / 10) * 100));
  const barCls =
    tone === 'positive' ? 'bg-ac-positive' : tone === 'notice' ? 'bg-ac-notice' : 'bg-ac-negative';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-ac-xs">
        <span className="font-ac-medium text-ac-text-secondary">{label}</span>
        <ToneText tone={tone}>
          <span className="font-ac-bold">{score.toFixed(1)}</span>
          <span className="text-ac-text-muted">/10</span>
        </ToneText>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-ac-full bg-ac-surface-2"
        role="img"
        aria-label={`${label}: ${score.toFixed(1)} out of 10`}
      >
        <div className={`h-full rounded-ac-full ${barCls}`} style={{ width: `${pct}%` }} />
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

function ClaimCard({ claim }: { claim: JudgeFlaggedClaim }) {
  const pct = Math.round(Math.min(1, Math.max(0, claim.certainty)) * 100);
  return (
    <div className="rounded-ac-sm border border-ac-border bg-ac-surface-2 px-3 py-2">
      <p className="m-0 text-ac-sm text-ac-text">&ldquo;{claim.claim}&rdquo;</p>
      <p className="m-0 mt-1 text-ac-xs text-ac-text-secondary">
        {claim.reason} <span className="text-ac-text-muted">· {pct}% certainty</span>
      </p>
    </div>
  );
}

function PerJudgeExpander({ perJudge }: { perJudge: JudgePerJudge[] }) {
  const [open, setOpen] = useState(false);
  if (perJudge.length === 0) return null;
  const ordered = JUDGE_ORDER.map((role) => perJudge.find((j) => j.role === role)).filter(
    (j): j is JudgePerJudge => Boolean(j),
  );
  return (
    <div className="rounded-ac-sm border border-ac-border">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-ac-xs font-ac-medium text-ac-text-secondary hover:bg-ac-surface-hover"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span>Per-judge breakdown ({ordered.length})</span>
      </button>
      {open && (
        <ul className="m-0 flex list-none flex-col gap-2 border-t border-ac-border px-3 py-2">
          {ordered.map((j) => {
            const tone = scoreTone(j.score);
            return (
              <li key={j.role} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-ac-xs font-ac-medium text-ac-text">{JUDGE_LABEL[j.role]}</span>
                  <ToneText tone={tone}>
                    <span className="text-ac-xs font-ac-bold">{j.score.toFixed(1)}/10</span>
                  </ToneText>
                </div>
                <p className="m-0 text-[11px] text-ac-text-muted">{JUDGE_LENS[j.role]}</p>
                {j.note && <p className="m-0 text-ac-xs text-ac-text-secondary">{j.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function JudgingSkeleton() {
  return (
    <div className="flex flex-col gap-3 motion-safe:animate-pulse" aria-live="polite" aria-busy="true">
      <div className="h-4 w-2/3 rounded-ac-sm bg-ac-surface-2" />
      <div className="h-3 w-full rounded-ac-sm bg-ac-surface-2" />
      <div className="h-3 w-full rounded-ac-sm bg-ac-surface-2" />
      <div className="h-3 w-4/5 rounded-ac-sm bg-ac-surface-2" />
      <p className="m-0 text-ac-xs text-ac-text-muted">
        Judging&hellip; live verdicts take about 14s (1 round, indicative).
      </p>
    </div>
  );
}

function EmptyPanelState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <span aria-hidden="true" className="text-ac-2xl text-ac-text-muted">
        ⚖
      </span>
      <p className="m-0 text-ac-sm text-ac-text-secondary">No answer to judge yet.</p>
      <p className="m-0 text-ac-xs text-ac-text-muted">
        Ask a question — the grounding verdict for the most recent answer appears here.
      </p>
    </div>
  );
}

export function JudgePanel({ turns }: JudgePanelProps) {
  const target = latestTarget(turns);
  const { status, verdict } = useJudge(target);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-ac-base font-ac-bold text-ac-text">Grounding verdict</h2>
        <span className="rounded-ac-full border border-ac-border bg-ac-informative-bg px-2 py-0.5 text-[10px] font-ac-bold uppercase tracking-wide text-ac-informative">
          indicative
        </span>
      </div>

      {target && (
        <div className="flex items-center gap-2">
          <AgentBadge agent={target.segment.agent} status={target.segment.status} />
        </div>
      )}

      {!target && <EmptyPanelState />}

      {target && status === 'idle' && (
        <p className="m-0 text-ac-xs text-ac-text-muted">Waiting for the answer to finish streaming&hellip;</p>
      )}

      {target && status === 'judging' && <JudgingSkeleton />}

      {target && (status === 'done' || status === 'error') && verdict && (
        <div className="flex flex-col gap-4">
          {verdict.error ? (
            <div className="rounded-ac-sm border border-ac-negative bg-ac-negative-bg px-3 py-2.5 text-ac-sm text-ac-negative">
              <p className="m-0 font-ac-medium">Judge unavailable</p>
              <p className="m-0 mt-1 text-ac-xs">{verdict.error}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-ac-xs font-ac-medium text-ac-text-muted">Confidence</span>
                  <span className={`text-ac-2xl font-ac-bold ${
                    scoreTone(verdict.composite) === 'positive'
                      ? 'text-ac-positive'
                      : scoreTone(verdict.composite) === 'notice'
                        ? 'text-ac-notice'
                        : 'text-ac-negative'
                  }`}>
                    {verdict.composite.toFixed(1)}
                    <span className="text-ac-sm font-ac-medium text-ac-text-muted">/10</span>
                  </span>
                </div>
                <GateBadge gateTripped={verdict.gateTripped} borderline={verdict.borderline} />
              </div>

              <div className="flex flex-col gap-3">
                {DIM_ORDER.map((d) => (
                  <DimBar key={d.key} label={d.label} score={verdict.dims[d.key]} />
                ))}
              </div>

              {verdict.flaggedClaims.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="m-0 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
                    Flagged claims ({verdict.flaggedClaims.length})
                  </h3>
                  <div className="flex flex-col gap-2">
                    {verdict.flaggedClaims.map((c, i) => (
                      <ClaimCard key={i} claim={c} />
                    ))}
                  </div>
                </div>
              )}

              <PerJudgeExpander perJudge={verdict.perJudge} />

              {verdict.rationale && (
                <div className="rounded-ac-sm border border-ac-border bg-ac-surface-2 px-3 py-2.5">
                  <h3 className="m-0 mb-1 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
                    Rationale
                  </h3>
                  <p className="m-0 text-ac-sm text-ac-text-secondary">{verdict.rationale}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
