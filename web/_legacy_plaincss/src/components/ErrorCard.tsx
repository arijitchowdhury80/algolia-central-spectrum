import type { AgentKind } from '../types';

const AGENT_LABEL: Record<AgentKind, string> = {
  generic: 'Generic',
  technical: 'Technical',
};

export interface ErrorCardProps {
  agent: AgentKind;
  onRetry: () => void;
}

/** Inline red-tinted error card. Never shows a raw stack trace — a fixed,
 *  friendly message plus a Retry button that re-runs the whole turn. */
export function ErrorCard({ agent, onRetry }: ErrorCardProps) {
  return (
    <div className="error-card" role="alert">
      <span className="error-card__text">
        Couldn&apos;t reach the {AGENT_LABEL[agent]} agent.
      </span>
      <button type="button" className="error-card__retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
