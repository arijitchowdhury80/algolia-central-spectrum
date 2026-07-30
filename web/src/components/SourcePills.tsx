import { useId, useState } from 'react';
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

type Group = ReturnType<typeof groupSources>[number];

/**
 * One category pill in the collapsed row: the group's label plus its source
 * count. The WHOLE pill is the toggle, not just the count badge — a 10px badge
 * is a poor click target, and the label carries the same meaning.
 */
function CategoryPill({
  group,
  open,
  panelId,
  onToggle,
}: {
  group: Group;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`${group.label}: ${group.sources.length} sources — ${open ? 'hide' : 'show'} them`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-ac-full border px-2.5 py-1 transition-colors duration-ac-fast ease-ac-ease ${
        open
          ? 'border-ac-accent bg-ac-accent-tint shadow-ac-1'
          : 'border-ac-border bg-ac-surface-2 hover:border-ac-accent'
      }`}
    >
      <span
        className={`text-[10px] font-ac-bold uppercase tracking-[0.1em] ${
          open ? 'text-ac-accent' : 'text-ac-text-secondary'
        }`}
      >
        {group.label}
      </span>
      <span
        className={`inline-flex min-w-[18px] items-center justify-center rounded-ac-full px-1.5 text-[10px] font-ac-bold ${
          open ? 'bg-ac-accent text-ac-text-on-accent' : 'bg-ac-accent-tint text-ac-accent'
        }`}
      >
        {group.sources.length}
      </span>
      {/* An SVG chevron, not a ▸/▾ glyph: at this size the glyph rendered as an
          indistinguishable dot next to the count. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 10 6"
        className={`h-[5px] w-[9px] transition-transform duration-ac-fast ease-ac-ease ${
          open ? 'rotate-180 text-ac-accent' : 'text-ac-text-muted'
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1 1l4 4 4-4" />
      </svg>
    </button>
  );
}

/**
 * The dropdown for the open category — every source in that group as a pill.
 * Release-note / changelog pages stay behind a "+N release notes" toggle so a
 * long changelog tail doesn't bury the substantive pages, and nothing is hidden
 * for good.
 */
function GroupPanel({ group, panelId }: { group: Group; panelId: string }) {
  const [expanded, setExpanded] = useState(false);
  const primary = group.sources.filter((s) => !isReleaseNote(s));
  const releaseList = group.sources.filter((s) => isReleaseNote(s));
  const releases = releaseList.length;
  const shown = expanded ? [...primary, ...releaseList] : primary;

  return (
    <div
      id={panelId}
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-ac-sm border border-ac-border bg-ac-surface-2 px-3 py-2.5"
    >
      {shown.map((s) => (
        <SourcePill key={s.id} s={s} />
      ))}

      {releases > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
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
 *
 * Shape (2026-07-28): the source facets render as ONE row of category
 * pills, collapsed by default; clicking a pill opens that category's sources as
 * a dropdown directly below the row. Ported from Algolia-Central's pill +
 * accordion pattern.
 *
 * Collapsed-by-default is the point: sources are proof, and proof should be one
 * click away rather than occupying more vertical space than the answer. Three
 * expanded rows of pills pushed the answer's own conclusion off screen.
 *
 * ONE group open at a time. The alternative (independent toggles) lets the card
 * grow tall enough to shift everything below it, and this block sits under every
 * answer in the transcript.
 *
 * Group labels come from `groupSources`, i.e. from the data's own `source`
 * facet — nothing corpus-specific is hardcoded here, so the component carries
 * over to any Algolia-Central instance unchanged.
 */
export function SourcePills({ sources }: SourcePillsProps) {
  const src = useSourceGroups(sources);
  if (!src.hasSources) return null;
  return (
    <div className="flex flex-col gap-2">
      <SourceRow src={src} />
      <SourcePanel src={src} />
    </div>
  );
}

/**
 * The accordion's state, lifted into a hook so a caller can render the pill ROW
 * and the dropdown PANEL at different places in its own layout.
 *
 * ChatMessage needs exactly that: the cost badge and grounding chip sit on the
 * same line as the pill row, so the panel has to open BELOW that whole line
 * rather than inside the column the pills live in — otherwise opening a category
 * drags the badges down with it.
 */
export function useSourceGroups(sources: AnswerSource[]) {
  const groups = groupSources(sources);
  // Collapsed by default: null = no group open.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Unique per instance — several answers render this block on one page, and
  // duplicate aria-controls ids would point a11y tools at the wrong panel.
  const baseId = useId();

  return {
    groups,
    hasSources: groups.length > 0,
    openGroup: groups.find((g) => g.key === openKey),
    panelId: (key: string) => `${baseId}-src-${key}`,
    isOpen: (key: string) => key === openKey,
    toggle: (key: string) => setOpenKey((k) => (k === key ? null : key)),
  };
}

export type SourceGroupsState = ReturnType<typeof useSourceGroups>;

/** The always-visible row: "Sources" label + one category pill per facet. */
export function SourceRow({ src }: { src: SourceGroupsState }) {
  if (!src.hasSources) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-ac-border pt-3" aria-label="Grounded sources">
      <span className="text-[10px] font-ac-bold uppercase tracking-[0.12em] text-ac-text-muted">Sources</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {src.groups.map((group) => (
          <CategoryPill
            key={group.key}
            group={group}
            open={src.isOpen(group.key)}
            panelId={src.panelId(group.key)}
            onToggle={() => src.toggle(group.key)}
          />
        ))}
      </div>
    </div>
  );
}

/** The dropdown for whichever category is open. Renders nothing when collapsed. */
export function SourcePanel({ src }: { src: SourceGroupsState }) {
  const open = src.openGroup;
  if (!open) return null;
  // Keyed on the group so switching categories remounts the panel, which resets
  // its "+N release notes" sub-toggle instead of leaking one group's expanded
  // state into the next.
  return <GroupPanel key={open.key} group={open} panelId={src.panelId(open.key)} />;
}
