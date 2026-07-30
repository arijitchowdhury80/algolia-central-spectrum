import { activeInstance } from '../../config/active';

export interface DiscoveryCardProps {
  question: string;
  onAsk: (question: string) => void;
  disabled?: boolean;
}

/**
 * Discovery follow-up card. `question` is `turn.followUp` — a suggestion
 * surfaced from the classifier or specialist agent. Renders as a one-click
 * card so the user can keep exploring.
 */
export function DiscoveryCard({ question, onAsk, disabled }: DiscoveryCardProps) {
  return (
    <button
      type="button"
      onClick={() => onAsk(question)}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-algolia-xl border border-algolia-border bg-algolia-surface px-4 py-3 text-left shadow-algolia-1 transition-all duration-algolia-base ease-algolia-ease hover:-translate-y-0.5 hover:border-algolia-accent hover:shadow-algolia-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-algolia-full text-algolia-accent"
        style={{ backgroundColor: 'var(--algolia-accent-tint)' }}
        aria-hidden="true"
      >
        ✦
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[10px] font-algolia-bold uppercase tracking-[0.14em] text-algolia-text-muted">
          {activeInstance.strings.discovery.eyebrow}
        </span>
        <span className="text-algolia-sm font-algolia-medium text-algolia-text">{question}</span>
      </span>
      <span
        className="ml-auto shrink-0 text-algolia-text-muted transition-colors duration-algolia-fast ease-algolia-ease group-hover:text-algolia-accent"
        aria-hidden="true"
      >
        &rarr;
      </span>
    </button>
  );
}
