import { useState } from 'react';
import { activeInstance } from '../config/active';

export interface SampleQuestionsProps {
  onPick: (question: string) => void;
  disabled?: boolean;
}

/**
 * Persistent "Sample questions" affordance above the composer (rc2 pattern).
 * Toggles a popover of the instance's sample questions — grouped into titled
 * sections — so the user can grab one at any point in the conversation. Groups
 * come from the active instance config (template-agnostic).
 */
export function SampleQuestions({ onPick, disabled }: SampleQuestionsProps) {
  const [open, setOpen] = useState(false);
  const groups = activeInstance.sampleQuestions;
  if (groups.length === 0) return null;

  return (
    <div className="relative flex justify-center">
      {open && (
        <>
          {/* click-away scrim */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute bottom-full left-1/2 z-20 mb-3 w-[min(94vw,52rem)] -translate-x-1/2 rounded-ac-xl border border-ac-border bg-ac-surface p-5 shadow-ac-3"
            role="dialog"
            aria-label="Sample questions"
          >
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {groups.map((group) => (
                <div key={group.section} className="flex flex-col gap-2">
                  <span className="text-[10px] font-ac-bold uppercase tracking-[0.14em] text-ac-accent">
                    {group.section}
                  </span>
                  <div className="flex flex-col gap-1">
                    {group.questions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setOpen(false);
                          onPick(q);
                        }}
                        className="group flex items-center gap-2 rounded-ac-md px-2.5 py-2 text-left text-ac-sm text-ac-text-secondary transition-colors duration-ac-fast ease-ac-ease hover:bg-ac-accent-tint hover:text-ac-text disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span
                          className="text-ac-text-muted transition-colors duration-ac-fast ease-ac-ease group-hover:text-ac-accent"
                          aria-hidden="true"
                        >
                          →
                        </span>
                        <span className="min-w-0">{q}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="relative z-20 inline-flex items-center gap-1.5 rounded-ac-full border border-ac-border bg-ac-surface px-3.5 py-1.5 text-ac-xs font-ac-medium text-ac-text-secondary shadow-ac-1 transition-colors duration-ac-fast ease-ac-ease hover:border-ac-accent hover:text-ac-text"
      >
        <span className="text-ac-accent" aria-hidden="true">✦</span>
        Sample questions
        <span className="text-ac-text-muted" aria-hidden="true">{open ? '⌄' : '⌃'}</span>
      </button>
    </div>
  );
}
