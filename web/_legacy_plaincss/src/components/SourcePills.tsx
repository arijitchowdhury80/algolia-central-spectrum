import type { CSSProperties } from 'react';
import { groupSources } from '../lib/sources';
import type { AnswerSource } from '../types';

export interface SourcePillsProps {
  sources: AnswerSource[];
}

/** CSSProperties doesn't model custom properties — this narrow helper casts
 *  just enough to set `--pill-accent` per-pill without an `any` escape hatch
 *  anywhere else in the component. */
function pillAccentStyle(accentVar: string): CSSProperties {
  return { '--pill-accent': `var(${accentVar})` } as CSSProperties;
}

/** Compact pills grouped by source facet. Each pill is a clickable link
 *  (title) opening the hit's url in a new tab; shows the facet tag. Sources
 *  without a url render as a non-link label (still shows the facet). */
export function SourcePills({ sources }: SourcePillsProps) {
  const groups = groupSources(sources);
  if (groups.length === 0) return null;

  return (
    <div className="source-pills" aria-label="Grounded sources">
      {groups.map((group) => (
        <div className="source-pills__group" key={group.key}>
          {group.sources.map((s) =>
            s.url ? (
              <a
                key={s.id}
                className="source-pill"
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                style={pillAccentStyle(group.accentVar)}
              >
                <span className="source-pill__title">{s.title}</span>
                <span className="source-pill__tag">{group.label}</span>
              </a>
            ) : (
              <span
                key={s.id}
                className="source-pill source-pill--static"
                style={pillAccentStyle(group.accentVar)}
              >
                <span className="source-pill__title">{s.title}</span>
                <span className="source-pill__tag">{group.label}</span>
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
