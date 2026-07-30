/**
 * ProactiveGreeting — assistant-authored opening message, shown when something
 * upstream decides to engage the visitor before they have typed anything.
 *
 * Rendered beneath the welcome hero inside the empty-state scroll area (see
 * ChatPanel / ChatWidget). Suggestion chips let the visitor start the
 * conversation in one click.
 *
 * Presentational: every value arrives via props so the component can be reused
 * outside the proactive store (tests, Storybook, alternative host integrations).
 */
import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';

export interface ProactiveGreetingProps {
  /** Assistant-authored greeting text. */
  greeting: string;
  /** Clickable follow-up questions. Empty array renders no chips. */
  suggestions: string[];
  /** Invoked with the chosen suggestion when a chip is clicked. */
  onPickSuggestion: (suggestion: string) => void;
  /**
   * Active persona name, rendered as an eyebrow above the greeting.
   * Omit to hide the eyebrow entirely.
   */
  personaLabel?: string | null;
}

/** Assistant avatar — chat-bubble glyph matching the launcher icon. */
function AssistantAvatar() {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-algolia-full bg-algolia-accent text-algolia-text-on-accent"
      aria-hidden
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
          d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}

export function ProactiveGreeting({
  greeting,
  suggestions,
  onPickSuggestion,
  personaLabel,
}: ProactiveGreetingProps) {
  const { widget } = activeInstance.strings;

  return (
    // The greeting appears asynchronously without user action, so announce it.
    // `polite` waits for a pause rather than interrupting the current utterance.
    <section
      aria-live="polite"
      aria-label={widget.proactiveGreetingLabel}
      className="flex w-full flex-col gap-3 pt-6 pb-4"
    >
      <div className="flex items-start gap-3">
        <AssistantAvatar />
        <div className="flex flex-col gap-1">
          {personaLabel && (
            <span className="text-algolia-xs font-algolia-bold uppercase tracking-[0.12em] text-algolia-accent">
              {interpolate(widget.proactivePersonaLabel, { persona: personaLabel })}
            </span>
          )}
          <div className="rounded-algolia-lg rounded-tl-sm bg-algolia-surface-2 px-4 py-3 text-algolia-sm text-algolia-text shadow-algolia-1">
            {greeting}
          </div>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="ml-11 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPickSuggestion(s)}
              className="min-h-[36px] rounded-algolia-full border border-algolia-border bg-algolia-accent-tint px-3 py-1.5 text-algolia-xs text-algolia-text shadow-algolia-1 transition-all duration-algolia-base ease-algolia-ease hover:-translate-y-0.5 hover:border-algolia-accent hover:shadow-algolia-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-algolia-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
