export interface DiscoveryCardProps {
  question: string;
  onAsk: (question: string) => void;
  disabled?: boolean;
}

/**
 * Discovery follow-up card. The front agent generates one contextual next
 * question per turn (its `[[FOLLOWUP: …]]` token, grounded in the conversation
 * history it already receives); we render it as a one-click card so the user
 * can keep exploring. Clicking asks it as the next turn.
 */
export function DiscoveryCard({ question, onAsk, disabled }: DiscoveryCardProps) {
  return (
    <button
      type="button"
      onClick={() => onAsk(question)}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-ac-xl border border-ac-border bg-ac-surface px-4 py-3 text-left shadow-ac-1 transition-all duration-ac-base ease-ac-ease hover:-translate-y-0.5 hover:border-ac-accent hover:shadow-ac-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ac-full text-ac-accent"
        style={{ backgroundColor: 'var(--ac-accent-tint)' }}
        aria-hidden="true"
      >
        ✦
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[10px] font-ac-bold uppercase tracking-[0.14em] text-ac-text-muted">
          You might also ask
        </span>
        <span className="text-ac-sm font-ac-medium text-ac-text">{question}</span>
      </span>
      <span
        className="ml-auto shrink-0 text-ac-text-muted transition-colors duration-ac-fast ease-ac-ease group-hover:text-ac-accent"
        aria-hidden="true"
      >
        &rarr;
      </span>
    </button>
  );
}
