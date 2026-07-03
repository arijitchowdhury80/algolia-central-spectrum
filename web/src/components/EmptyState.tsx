import { activeInstance } from '../config/active';

export interface EmptyStateProps {
  onPick: (question: string) => void;
}

/** Hero prompt + sample-question chips (from the active instance config) + a
 *  one-line trust disclaimer. Shown only before the first turn. */
export function EmptyState({ onPick }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-ac-measure flex-col items-center gap-5 px-4 text-center">
      <span className="text-ac-xs font-ac-bold uppercase tracking-[0.16em] text-ac-accent">
        Grounded search
      </span>
      <h1 className="m-0 font-ac-sans text-[clamp(28px,4vw,40px)] font-ac-bold leading-ac-heading text-ac-text">
        Ask about {activeInstance.corpusName}
      </h1>
      <div className="flex flex-wrap justify-center gap-2.5">
        {/* one representative question per section — the full grouped set lives
            in the "Sample questions" popover above the composer. */}
        {activeInstance.sampleQuestions.map((group) => (
          <button
            key={group.section}
            type="button"
            onClick={() => onPick(group.questions[0])}
            className="min-h-[44px] rounded-ac-full border border-ac-border bg-ac-surface px-4 py-2 text-ac-sm text-ac-text-secondary shadow-ac-1 transition-all duration-ac-base ease-ac-ease hover:-translate-y-0.5 hover:border-ac-accent hover:text-ac-text hover:shadow-ac-2"
          >
            {group.questions[0]}
          </button>
        ))}
      </div>
      <p className="m-0 text-ac-xs text-ac-text-muted">{activeInstance.disclaimer}</p>
    </div>
  );
}
