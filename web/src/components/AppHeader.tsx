import { activeInstance } from '../config/active';

export interface AppHeaderProps {
  /** Reset the whole conversation (wired to a logo click). */
  onReset: () => void;
}

/** Client-branded header — the client's logo (Adobe, for ACS) + product/
 *  corpus title. Looks like a client asset, not an Algolia asset — Algolia's
 *  presence is confined to PoweredByAlgolia.
 *
 *  The logo + title is a button: clicking it resets the session (clears the
 *  conversation, back to the start) — the common "click the wordmark to go
 *  home" affordance. */
export function AppHeader({ onReset }: AppHeaderProps) {
  return (
    <header
      className="flex h-[var(--ac-header-h)] shrink-0 items-center justify-between border-b border-ac-border px-6 backdrop-blur-md"
      style={{ background: 'color-mix(in srgb, var(--ac-surface) 82%, transparent)' }}
    >
      <button
        type="button"
        onClick={onReset}
        aria-label={`${activeInstance.brandName} — reset conversation`}
        title="Start over — clear this conversation"
        className="-mx-2 flex items-center gap-3 rounded-ac-md px-2 py-1 transition-colors duration-ac-fast ease-ac-ease hover:bg-ac-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ac-accent"
      >
        <img src={activeInstance.logo.header} alt={`${activeInstance.brandName} logo`} className="h-8 w-8 shrink-0" />
        <div className="flex flex-col text-left leading-tight">
          <span className="font-ac-sans text-ac-base font-ac-medium text-ac-text">{activeInstance.productTitle}</span>
          <span className="text-ac-xs text-ac-text-muted">{activeInstance.subtitle}</span>
        </div>
      </button>

      {/* Cobrand: Adobe (corpus, left) × Algolia (search platform, right). */}
      <div className="flex items-center gap-2">
        <span className="hidden text-ac-xs text-ac-text-muted sm:inline">Search by</span>
        <img src="/brand/algolia-logo.svg" alt="Algolia" className="h-[18px] w-auto shrink-0" />
      </div>
    </header>
  );
}
