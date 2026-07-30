import { activeInstance } from '../config/active';
import type { AgentKind } from '../types';

export interface ErrorCardProps {
  agent: AgentKind;
  onRetry: () => void;
}

/**
 * Inline error card for a SERVICE failure (network/HTTP error reaching an
 * agent) — visually and semantically distinct from a valid grounded refusal,
 * which renders as normal assistant text via MessageMarkdown, not this card.
 * Never shows a raw stack trace — a fixed, friendly message plus a Retry
 * button that re-runs the whole turn.
 */
export function ErrorCard({ agent, onRetry }: ErrorCardProps) {
  const label = activeInstance.agents[agent].label;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-ac-sm border border-ac-negative bg-ac-negative-bg px-3.5 py-2.5 text-ac-sm text-ac-negative"
    >
      <span>Couldn&apos;t reach the {label} agent. This is a service error, not an answer.</span>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[36px] rounded-ac-sm border border-ac-negative bg-transparent px-3.5 font-ac-medium text-ac-negative transition-colors duration-ac-fast ease-ac-ease hover:bg-ac-negative hover:text-ac-text-on-accent"
      >
        Retry
      </button>
    </div>
  );
}
