import { useCostEntries, summarizeCostEntries } from '../lib/costStore';

/**
 * CostPage — session-wide cumulative cost (spike plan §6). Reachable from the
 * header nav (AppHeader's "Cost" button). Aggregates every cost entry
 * recorded this session — one per finished agent answer (ESTIMATED) and one
 * per resolved judge verdict that carried usage (EXACT) — broken out by
 * kind (agent/judge) and method (ESTIMATED/EXACT), never blended into one
 * ambiguous number.
 */
export interface CostPageProps {
  onClose: () => void;
}

function fmtUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  return `$${n.toFixed(4)}`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-ac-lg border border-ac-border bg-ac-surface p-4 shadow-ac-1">
      <span className="text-ac-xs font-ac-medium text-ac-text-muted">{label}</span>
      <span className="text-ac-2xl font-ac-bold text-ac-text">{value}</span>
      {sub && <span className="text-[11px] text-ac-text-muted">{sub}</span>}
    </div>
  );
}

export function CostPage({ onClose }: CostPageProps) {
  const entries = useCostEntries();
  const totals = summarizeCostEntries(entries);
  const agentEntries = entries.filter((e) => e.kind === 'agent');
  const judgeEntries = entries.filter((e) => e.kind === 'judge');
  const byTurn = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byTurn.get(e.turnId) ?? [];
    list.push(e);
    byTurn.set(e.turnId, list);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-ac-border bg-ac-surface px-6 py-4">
        <div className="flex flex-col">
          <h1 className="m-0 text-ac-lg font-ac-bold text-ac-text">Session cost</h1>
          <p className="m-0 text-ac-xs text-ac-text-muted">
            Cumulative tokens + spend across this conversation — agent (ESTIMATED) vs. judge (EXACT).
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-ac-full border border-ac-border px-3 py-1.5 text-ac-sm font-ac-medium text-ac-text transition-colors duration-ac-fast ease-ac-ease hover:border-ac-accent hover:bg-ac-surface-hover"
        >
          ← Back to chat
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
        {entries.length === 0 ? (
          <p className="m-0 text-ac-sm text-ac-text-muted">
            No cost recorded yet this session — ask a question first.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Total spend" value={fmtUsd(totals.totalCostUsd)} />
              <StatTile
                label="Agent (ESTIMATED)"
                value={fmtUsd(totals.agentCostUsd)}
                sub={`${agentEntries.length} answer${agentEntries.length === 1 ? '' : 's'}`}
              />
              <StatTile
                label="Judge (EXACT)"
                value={fmtUsd(totals.judgeCostUsd)}
                sub={`${judgeEntries.length} verdict${judgeEntries.length === 1 ? '' : 's'}`}
              />
              <StatTile
                label="Tokens (in / out)"
                value={`${totals.totalInputTokens.toLocaleString()} / ${totals.totalOutputTokens.toLocaleString()}`}
              />
            </div>

            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-ac-xs font-ac-bold uppercase tracking-wide text-ac-text-secondary">
                By turn
              </h2>
              <div className="flex flex-col gap-2">
                {[...byTurn.entries()].map(([turnId, list]) => {
                  const turnTotals = summarizeCostEntries(list);
                  return (
                    <div key={turnId} className="rounded-ac-md border border-ac-border bg-ac-surface p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-ac-xs text-ac-text-muted">Turn {turnId.slice(0, 8)}</span>
                        <span className="text-ac-sm font-ac-bold text-ac-text">{fmtUsd(turnTotals.totalCostUsd)}</span>
                      </div>
                      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                        {list.map((e) => (
                          <li
                            key={e.id}
                            className="flex items-center justify-between gap-2 text-[11px] text-ac-text-secondary"
                          >
                            <span>
                              {e.agent} · {e.kind}{' '}
                              <span
                                className={
                                  e.method === 'EXACT' ? 'text-ac-positive' : 'text-ac-notice'
                                }
                              >
                                {e.method}
                              </span>{' '}
                              · {e.model}
                            </span>
                            <span>
                              {e.inputTokens.toLocaleString()}/{e.outputTokens.toLocaleString()} tok ·{' '}
                              {fmtUsd(e.costUsd)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
