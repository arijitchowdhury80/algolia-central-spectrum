import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';

export interface EmptyStateProps {
  onPick: (question: string) => void;
  /**
   * Hide the eyebrow/heading/helper and the sample-question chips. Set when a
   * proactive greeting renders below this component: the greeting already
   * carries an opening line and its own suggestion chips, so keeping the full
   * hero too is redundant and — in the docked panel — pushes the greeting
   * below the fold, behind the composer. The disclaimer still renders.
   */
  hideHero?: boolean;
}

/** Hero prompt + sample-question chips + a one-line trust disclaimer.
 *  Shown only before the first turn.
 *
 *  When a `[slot="welcome"]` element is present in the host page's light DOM,
 *  the eyebrow / heading / description are replaced by the slotted HTML so
 *  consumers can project a fully custom welcome (avatar image, branded copy,
 *  etc.). The sample-question chips and disclaimer still render below it. */
export function EmptyState({ onPick, hideHero }: EmptyStateProps) {
  const s = activeInstance.strings.empty;

  return (
    <div className="mx-auto flex max-w-algolia-measure flex-col items-center gap-5 px-4 text-center">
      {!hideHero && (
        <>
          {activeInstance.welcome.show &&
            (activeInstance.welcome.present ? (
              // Native shadow-DOM slot: projects <... slot="welcome"> from the light DOM.
              // TypeScript knows <slot> as a standard HTML element so no cast needed.
              <slot name="welcome" />
            ) : (
              <>
                <span className="text-algolia-xs font-algolia-bold uppercase tracking-[0.16em] text-algolia-accent">
                  {s.eyebrow}
                </span>
                <h1 className="m-0 font-algolia-sans text-[clamp(28px,4vw,40px)] font-algolia-bold leading-ac-heading text-algolia-text">
                  {interpolate(s.heading, { corpus: activeInstance.corpusName })}
                </h1>
                <p className="m-0 text-algolia-xs text-algolia-text-muted">{s.helper}</p>
              </>
            ))}
          <div className="flex flex-wrap justify-center gap-2.5">
            {activeInstance.sampleQuestions.map((group) => (
              <button
                key={group.section}
                type="button"
                onClick={() => onPick(group.questions[0])}
                className="min-h-[44px] rounded-algolia-full border border-algolia-border bg-algolia-accent-tint px-4 py-2 text-algolia-sm text-algolia-text shadow-algolia-1 transition-all duration-algolia-base ease-algolia-ease hover:-translate-y-0.5 hover:border-algolia-accent hover:shadow-algolia-2"
              >
                {group.questions[0]} →
              </button>
            ))}
          </div>
        </>
      )}
      <p className="m-0 text-algolia-xs text-algolia-text-muted">{activeInstance.disclaimer}</p>
    </div>
  );
}
