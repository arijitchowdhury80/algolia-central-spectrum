import { useState } from 'react';
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

/** One source rendered as a pill — a link when it has a URL (click to verify),
 *  static otherwise. */
function SourcePill({ s }: { s: AnswerSource }) {
  return s.url ? (
    <a href={s.url} target="_blank" rel="noopener noreferrer" className={PILL} title={s.title}>
      <span className={NAME}>{cleanTitle(s)}</span>
    </a>
  ) : (
    <span className={PILL_STATIC} title={s.title}>
      <span className={NAME}>{cleanTitle(s)}</span>
    </span>
  );
}

/** One facet group. The count badge is a toggle when the group has collapsed
 *  (release-note) sources: clicking it — or the "+N release notes" pill —
 *  expands every source in the group as a clickable link so the user can open
 *  and verify each one. */
function SourceGroup({ group }: { group: ReturnType<typeof groupSources>[number] }) {
  const [expanded, setExpanded] = useState(false);
  const primary = group.sources.filter((s) => !isReleaseNote(s));
  const releaseList = group.sources.filter((s) => isReleaseNote(s));
  const releases = releaseList.length;
  if (primary.length === 0 && releases === 0) return null;

  const hasHidden = releases > 0;
  const shown = expanded ? [...primary, ...releaseList] : primary;
  const toggle = () => setExpanded((v) => !v);

  const countBadge = (
    <span
      className={`inline-flex min-w-[18px] items-center justify-center rounded-ac-full bg-ac-accent-tint px-1.5 text-[10px] font-ac-bold text-ac-accent ${
        hasHidden ? 'cursor-pointer hover:bg-ac-accent hover:text-ac-text-on-accent' : ''
      }`}
    >
      {group.sources.length}
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <span className="text-[10px] font-ac-bold uppercase tracking-[0.1em] text-ac-text-secondary">
          {group.label}
        </span>
        {hasHidden ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={`${group.label}: ${group.sources.length} sources — ${expanded ? 'collapse' : 'expand to view and verify each'}`}
          >
            {countBadge}
          </button>
        ) : (
          countBadge
        )}
      </span>

      {shown.map((s) => (
        <SourcePill key={s.id} s={s} />
      ))}

      {hasHidden && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="inline-flex items-center gap-0.5 rounded-ac-full px-1 text-ac-xs text-ac-text-muted transition-colors hover:text-ac-accent"
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          {expanded ? 'show less' : `+${releases} release note${releases > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}

/**
 * Grounded source badges built ONLY from the answer's `a:` hit frames.
 * Grouped by source facet: the facet is a section label with a count, titles
 * are cleaned of the redundant " | React Spectrum" / " – V3" tail, and
 * changelog/release pages collapse behind a clickable "+N release notes" toggle.
 * Every source is a link (click to open and verify); the count badge and the
 * "+N" toggle expand the collapsed ones so nothing is hidden for good.
 */
export function SourcePills({ sources }: SourcePillsProps) {
  const groups = groupSources(sources);
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-ac-border pt-3" aria-label="Grounded sources">
      <span className="text-[10px] font-ac-bold uppercase tracking-[0.12em] text-ac-text-muted">Sources</span>
      {groups.map((group) => (
        <SourceGroup key={group.key} group={group} />
      ))}
    </div>
  );
}
