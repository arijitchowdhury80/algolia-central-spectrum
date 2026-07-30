import { useState } from 'react';
import { activeInstance } from '../../config/active';

export interface SampleQuestionsProps {
  onPick: (question: string) => void;
  disabled?: boolean;
}

/** Default per-category accent palette, in section order. Overridable per-index
 *  via `--algolia-sq-accent-{i}` (see the `theme` slot) — these are only the
 *  fallback so the popover looks intentional with zero host configuration.
 *  Chosen to read as progressively "heavier": calm blue for foundational
 *  material, through to Adobe's own red for the most hands-on category, so
 *  the last column visually signals "this is where it gets real". */
const DEFAULT_CATEGORY_ACCENTS = ['#3b5bfd', '#7c3aed', '#fa0f00', '#0ea5a5', '#d97706'];

/** Persistent "Sample questions" affordance above the composer. Toggles a
 *  popover of the instance's sample questions — grouped into titled sections.
 *  Each section gets a per-category accent: a soft gradient wash (not a flat
 *  tinted box — a solid background reads as a "card" and shrinks the
 *  perceived text size) and a thin divider between columns with a touch of
 *  drop shadow. Deliberately NOT a bordered/boxed card: that read heavier and
 *  less clean in review than the plain layout it replaces.
 *
 *  The divider is a left border + shadow on every column after the first.
 *  That is directionally correct for the common multi-column desktop case;
 *  when the grid collapses to one column at narrow widths (see SIZING below)
 *  it degrades to a thin left-edge accent on each stacked block rather than a
 *  gap-spanning rule — a minor, deliberate simplification, not a broken state.
 *
 *  SIZING: the popover and its column count are driven by the CONTAINER, not by
 *  the viewport. The widget panel is a fixed-width, `overflow-hidden` box
 *  (`min(420px, 100vw - 32px)` docked, `85vw` normal), so a viewport-sized
 *  popover — the previous `w-[min(94vw,52rem)]` — rendered wider than its own
 *  panel on any desktop narrower than ~890px and was clipped on both sides.
 *  For the same reason the columns use `auto-fit`/`minmax` rather than the
 *  `sm:` breakpoint: `sm:` asks how wide the WINDOW is, which says nothing
 *  about the 420px box the questions actually have to fit in.
 *
 *  HEIGHT has the same failure mode: measured in a 640px docked panel, the
 *  popover rendered 676px tall and its first group was cut off 204px above the
 *  panel's top edge. A percentage cannot fix it — the containing block is the
 *  32px toggle row — so the panel publishes its own height as
 *  `--algolia-chat-panel-height` (ChatWidget.getPanelGeometry) and the popover
 *  bounds itself to it, scrolling internally past that. The 15rem reserve is
 *  measured, not guessed: 4rem of AppHeader above (the popover would otherwise
 *  slide under it and lose its first section heading) plus ~11rem of composer,
 *  toggle and footer below. The `80vh` fallback keeps this sane if the popover
 *  is ever rendered outside the panel. */
export function SampleQuestions({ onPick, disabled }: SampleQuestionsProps) {
  const [open, setOpen] = useState(false);
  const groups = activeInstance.sampleQuestions;
  if (groups.length === 0) return null;

  return (
    <div className="relative flex justify-center">
      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute bottom-full left-1/2 z-20 mb-3 max-h-[calc(var(--algolia-chat-panel-height,80vh)-15rem)] w-full max-w-[52rem] -translate-x-1/2 overflow-y-auto rounded-algolia-xl border border-algolia-border bg-algolia-surface p-5 shadow-algolia-3"
            role="dialog"
            aria-label={activeInstance.strings.sampleQuestions.dialogLabel}
          >
            <div className="grid gap-x-0 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
              {groups.map((group, i) => {
                const accent = `var(--algolia-sq-accent-${i}, ${DEFAULT_CATEGORY_ACCENTS[i % DEFAULT_CATEGORY_ACCENTS.length]})`;
                return (
                  <div
                    key={group.section}
                    data-sample-category={group.section}
                    data-sample-category-index={i}
                    className="flex flex-col gap-2 rounded-algolia-lg px-4 py-1 first:pl-1"
                    style={{
                      background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 7%, transparent) 0%, transparent 65%)`,
                      borderLeft: i === 0 ? undefined : '1px solid color-mix(in srgb, #000 8%, transparent)',
                      boxShadow: i === 0 ? undefined : '-6px 0 10px -8px rgba(0,0,0,0.18)',
                    }}
                  >
                    <span
                      className="text-[10px] font-algolia-bold uppercase tracking-[0.14em]"
                      style={{ color: accent }}
                    >
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
                          className="group flex items-center gap-2 rounded-algolia-md px-2.5 py-2 text-left text-algolia-sm text-algolia-text-secondary transition-colors duration-algolia-fast ease-algolia-ease hover:bg-algolia-accent-tint hover:text-algolia-text disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span
                            className="transition-colors duration-algolia-fast ease-algolia-ease"
                            style={{ color: accent }}
                            aria-hidden="true"
                          >
                            →
                          </span>
                          <span className="min-w-0">{q}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="relative z-20 inline-flex items-center gap-1.5 rounded-algolia-full border border-algolia-border bg-algolia-surface px-3.5 py-1.5 text-algolia-xs font-algolia-medium text-algolia-text-secondary shadow-algolia-1 transition-colors duration-algolia-fast ease-algolia-ease hover:border-algolia-accent hover:text-algolia-text"
      >
        <span className="text-algolia-accent" aria-hidden="true">
          ✦
        </span>
        {activeInstance.strings.sampleQuestions.toggleLabel}
        <span className="text-algolia-text-muted" aria-hidden="true">
          {open ? '⌄' : '⌃'}
        </span>
      </button>
    </div>
  );
}
