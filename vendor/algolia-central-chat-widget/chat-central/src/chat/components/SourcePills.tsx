import { useState } from 'react';
import { groupSources, cleanTitle, isReleaseNote } from '../lib/sources';
import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';
import type { AnswerSource } from '../types';

export interface SourcePillsProps {
  sources: AnswerSource[];
}

const PILL =
  'inline-flex max-w-full items-center rounded-algolia-full border border-algolia-border bg-algolia-accent-tint px-2.5 py-0.5 text-algolia-xs text-algolia-text no-underline transition-colors duration-algolia-fast ease-algolia-ease hover:border-algolia-accent';
const PILL_STATIC =
  'inline-flex max-w-full items-center rounded-algolia-full border border-algolia-border bg-algolia-surface-2 px-2.5 py-0.5 text-algolia-xs text-algolia-text opacity-85';
const NAME = 'max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap';

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

interface SourceDisplay {
  primary: ReturnType<typeof groupSources>[number]['sources'];
  releases: number;
  releaseList: ReturnType<typeof groupSources>[number]['sources'];
}

function buildSourceDisplay(group: ReturnType<typeof groupSources>[number]): SourceDisplay {
  const primary = group.sources.filter((s) => !isReleaseNote(s));
  const releaseList = group.sources.filter((s) => isReleaseNote(s));
  return { primary, releases: releaseList.length, releaseList };
}

function ExpandToggle({
  expanded,
  releases,
  onToggle,
}: {
  expanded: boolean;
  releases: number;
  onToggle: () => void;
}) {
  const s = activeInstance.strings.sources;
  const label = expanded
    ? s.showLess
    : interpolate(releases > 1 ? s.moreMany : s.moreOne, { count: releases });
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="inline-flex items-center gap-0.5 rounded-algolia-full px-1 text-algolia-xs text-algolia-text-muted transition-colors hover:text-algolia-accent"
    >
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      {label}
    </button>
  );
}

function SourceGroup({
  group,
  open,
  onToggleGroup,
}: {
  group: ReturnType<typeof groupSources>[number];
  open: boolean;
  onToggleGroup: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { primary, releases, releaseList } = buildSourceDisplay(group);
  if (primary.length === 0 && releases === 0) return null;

  const shown = expanded ? [...primary, ...releaseList] : primary;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <span className="text-[10px] font-algolia-bold uppercase tracking-[0.1em] text-algolia-text-secondary">
          {group.label}
        </span>
        <button
          type="button"
          onClick={onToggleGroup}
          aria-expanded={open}
          aria-label={interpolate(activeInstance.strings.sources.groupAria, {
            label: group.label,
            count: group.sources.length,
            action: open
              ? activeInstance.strings.sources.collapse
              : activeInstance.strings.sources.expand,
          })}
        >
          <span className="inline-flex min-w-[18px] cursor-pointer items-center justify-center rounded-algolia-full bg-algolia-accent-tint px-1.5 text-[10px] font-algolia-bold text-algolia-accent hover:bg-algolia-accent hover:text-algolia-text-on-accent">
            {group.sources.length}
          </span>
        </button>
      </span>

      {open && (
        <>
          {shown.map((s) => (
            <SourcePill key={s.id} s={s} />
          ))}
          {releases > 0 && (
            <ExpandToggle
              expanded={expanded}
              releases={releases}
              onToggle={() => setExpanded((v) => !v)}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Grounded source badges built from the answer's `a:` hit frames. Grouped by
 *  source facet, titles cleaned, release pages collapsed behind a toggle. */
export function SourcePills({ sources }: SourcePillsProps) {
  const groups = groupSources(sources);
  /**
   * Which facet is expanded, or null for none.
   *
   * Collapsed by default, and one at a time. Sources are supporting evidence:
   * with every facet expanded they occupied more vertical space than the answer
   * itself, which is especially costly in the docked panel where the reader has
   * little room. Collapsed, the facet labels and counts still show what the
   * answer drew on, and a click reveals the pills for one facet.
   *
   * One-at-a-time rather than independent toggles because this block sits
   * directly under a streaming answer — letting all facets open at once shifts
   * everything below them mid-stream.
   */
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (groups.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-2 border-t border-algolia-border pt-3"
      aria-label={activeInstance.strings.sources.sectionLabel}
    >
      <span className="text-[10px] font-algolia-bold uppercase tracking-[0.12em] text-algolia-text-muted">
        {activeInstance.strings.sources.heading}
      </span>
      {groups.map((group) => (
        <SourceGroup
          key={group.key}
          group={group}
          open={group.key === openKey}
          onToggleGroup={() => setOpenKey((k) => (k === group.key ? null : group.key))}
        />
      ))}
    </div>
  );
}
