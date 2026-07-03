import { groupSources, cleanTitle, isReleaseNote } from '../lib/sources';
import type { AnswerSource } from '../types';

export interface SourcePillsProps {
  sources: AnswerSource[];
}

const PILL =
  'inline-flex max-w-full items-center rounded-ac-full border border-ac-border bg-ac-accent-tint px-2.5 py-0.5 text-ac-xs text-ac-text no-underline transition-colors duration-ac-fast ease-ac-ease hover:border-ac-accent';
const PILL_STATIC =
  'inline-flex max-w-full items-center rounded-ac-full border border-ac-border bg-ac-surface-2 px-2.5 py-0.5 text-ac-xs text-ac-text opacity-85';
const NAME = 'max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap';

/**
 * Grounded source badges built ONLY from the answer's `a:` hit frames.
 * Grouped by source facet, shown compactly: the facet is a section LABEL with a
 * count (like the reference's category chips), titles are cleaned of the
 * redundant " | React Spectrum" / " – V3" tail, and changelog/release pages
 * collapse into a "+N release notes" count. Citations stay transparent without
 * the wall of identical pills.
 */
export function SourcePills({ sources }: SourcePillsProps) {
  const groups = groupSources(sources);
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-ac-border pt-3" aria-label="Grounded sources">
      <span className="text-[10px] font-ac-bold uppercase tracking-[0.12em] text-ac-text-muted">Sources</span>
      {groups.map((group) => {
        const primary = group.sources.filter((s) => !isReleaseNote(s));
        const releases = group.sources.length - primary.length;
        if (primary.length === 0 && releases === 0) return null;
        return (
          <div key={group.key} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <span className="text-[10px] font-ac-bold uppercase tracking-[0.1em] text-ac-text-secondary">
                {group.label}
              </span>
              <span className="inline-flex min-w-[18px] items-center justify-center rounded-ac-full bg-ac-accent-tint px-1.5 text-[10px] font-ac-bold text-ac-accent">
                {group.sources.length}
              </span>
            </span>
            {primary.map((s) =>
              s.url ? (
                <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className={PILL} title={s.title}>
                  <span className={NAME}>{cleanTitle(s)}</span>
                </a>
              ) : (
                <span key={s.id} className={PILL_STATIC} title={s.title}>
                  <span className={NAME}>{cleanTitle(s)}</span>
                </span>
              ),
            )}
            {releases > 0 && (
              <span className="text-ac-xs text-ac-text-muted">
                +{releases} release note{releases > 1 ? 's' : ''}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
