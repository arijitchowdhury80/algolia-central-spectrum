import { useState } from 'react';
import { useCostEntries } from '../lib/costStore';
import type { AgentKind } from '../types';

/**
 * CostBadge — per-answer, on-demand cost callout (spike plan §6). Sits next
 * to the ConfidenceChip. A quiet "$" pill; click to reveal the breakdown for
 * THIS answer: the agent's ESTIMATED cost (always present once the answer
 * finishes) and the judge's EXACT cost (only once its verdict resolves with
 * usage — absent on an older judge deployment, in which case that row simply
 * doesn't render). ESTIMATED and EXACT are never merged into one number —
 * each row keeps its own label so nobody mistakes a guess for a measurement.
 */
export interface CostBadgeProps {
  turnId: string;
  agent: AgentKind;
}

function fmtUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  return `$${n.toFixed(4)}`;
}

export function CostBadge({ turnId, agent }: CostBadgeProps) {
  const [open, setOpen] = useState(false);
  const entries = useCostEntries();
  const forThisAnswer = entries.filter((e) => e.turnId === turnId && e.agent === agent);
  if (forThisAnswer.length === 0) return null;

  const totalUsd = forThisAnswer.reduce((sum, e) => sum + e.costUsd, 0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Cost for this answer — click for the token/model breakdown"
        className="inline-flex items-center gap-1 rounded-ac-full border border-ac-border bg-ac-surface-2 px-2.5 py-1 text-ac-xs font-ac-medium text-ac-text-muted transition-colors duration-ac-fast ease-ac-ease hover:border-ac-accent hover:text-ac-text"
      >
        <span aria-hidden="true">$</span>
        <span>{fmtUsd(totalUsd)}</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-10 mb-2 w-72 rounded-ac-md border border-ac-border bg-ac-surface p-3 shadow-ac-2">
          <p className="m-0 mb-2 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
            Cost — this answer
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {forThisAnswer.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 rounded-ac-sm bg-ac-surface-2 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ac-xs font-ac-medium text-ac-text">
                    {e.kind === 'agent' ? 'Agent' : 'Judge'}
                  </span>
                  <span
                    className={`rounded-ac-sm px-1.5 py-0.5 text-[10px] font-ac-bold uppercase tracking-wide ${
                      e.method === 'EXACT'
                        ? 'bg-ac-positive-bg text-ac-positive'
                        : 'bg-ac-notice-bg text-ac-notice'
                    }`}
                  >
                    {e.method}
                  </span>
                </div>
                <span className="text-[11px] text-ac-text-muted">{e.model}</span>
                <div className="flex items-center justify-between text-[11px] text-ac-text-secondary">
                  <span>
                    {e.inputTokens.toLocaleString()} in / {e.outputTokens.toLocaleString()} out
                  </span>
                  <span className="font-ac-bold text-ac-text">{fmtUsd(e.costUsd)}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2 text-[10px] text-ac-text-muted">
            ESTIMATED = text-length heuristic (Agent Studio reports no real token usage). EXACT = the judge&rsquo;s
            own provider-reported tokens × published rate.
          </p>
        </div>
      )}
    </div>
  );
}
