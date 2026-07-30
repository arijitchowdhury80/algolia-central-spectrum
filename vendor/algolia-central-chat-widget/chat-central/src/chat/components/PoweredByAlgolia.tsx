import { activeInstance } from '../../config/active';

/** Fixed attribution present on every instance — search is always Algolia-powered. */
export function PoweredByAlgolia() {
  const { label, logo } = activeInstance.poweredBy;
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 text-algolia-xs text-algolia-text-muted">
      <span>{label}</span>
      {logo && <img src={logo} alt="Algolia" className="h-3.5 w-auto opacity-70" />}
    </div>
  );
}
