import { activeInstance } from '../config/active';

export interface DeepDivePromptProps {
  onAccept: () => void;
  onDecline: () => void;
  disabled?: boolean;
}

/**
 * Human-gated deep-dive consent card (the RC2 handoff pattern). When the
 * front assistant judges that a question warrants a specialist, we don't
 * auto-run it — we ASK. The user clicks in to run the specialist, or
 * dismisses. Nothing runs without consent.
 *
 * The specialist's display name comes from the active instance config so the
 * copy stays instance-agnostic (template goal).
 */
export function DeepDivePrompt({ onAccept, onDecline, disabled }: DeepDivePromptProps) {
  const specialist = activeInstance.agents.technical.label;
  return (
    <div
      className="flex flex-col gap-3 rounded-ac-xl border border-ac-border bg-ac-accent-tint p-4 shadow-ac-1 backdrop-blur-md"
      role="group"
      aria-label="Deep-dive offer"
    >
      <p className="m-0 text-ac-sm text-ac-text">
        For this topic, our {specialist} can go deeper on the code and API details.
        Want me to bring them in?
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          className="ac-glow-accent inline-flex items-center gap-1.5 rounded-ac-full bg-ac-accent px-3.5 py-1.5 text-ac-xs font-ac-medium text-ac-text-on-accent transition-opacity duration-ac-fast ease-ac-ease hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">⚙</span>
          Yes, go deeper
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={disabled}
          className="rounded-ac-full px-3 py-1.5 text-ac-xs font-ac-medium text-ac-text-secondary transition-colors duration-ac-fast ease-ac-ease hover:bg-ac-surface-hover hover:text-ac-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
