import { activeInstance } from '../config/active';

/**
 * Fixed structure element present on every instance regardless of its skin
 * — search is always Algolia-powered. DocSearch-style: small, subtle,
 * attribution-only. See config/instance.ts `poweredBy`.
 */
export function PoweredByAlgolia() {
  const { label, logo } = activeInstance.poweredBy;
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 text-ac-xs text-ac-text-muted">
      <span>{label}</span>
      <img src={logo} alt="Algolia" className="h-3.5 w-auto opacity-70" />
    </div>
  );
}
