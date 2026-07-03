/**
 * sources — normalize raw Agent Studio `a:` hits into AnswerSource, then group
 * by the hit's `source` facet for the pill UI. Adapted from AC2's
 * `web/src/lib/sources.ts` grouping pattern, but simplified: the ACS corpus
 * hits carry an explicit `source` facet (SpectrumDesignDocs / ReactSpectrumS2 /
 * ReactSpectrumV3 / ReactAria / ReactSpectrumReleases), so there's no need for
 * AC2's URL-inference fallback chain — unknown/missing facets bucket to
 * "Other". Pure functions, no DOM, no React.
 */
import type { AnswerSource } from '../types';

export interface SourceGroupMeta {
  key: string;
  label: string;
  /** CSS custom-property name for the pill accent (tokens.css). */
  accentVar: string;
}

export interface SourceGroup extends SourceGroupMeta {
  sources: AnswerSource[];
}

/** Display order + presentation for the known ACS source facets. Anything else
 *  (or missing) buckets to 'other'. */
const GROUP_META: SourceGroupMeta[] = [
  { key: 'SpectrumDesignDocs', label: 'Spectrum Design Docs', accentVar: '--source-design' },
  { key: 'ReactSpectrumS2', label: 'React Spectrum S2', accentVar: '--source-s2' },
  { key: 'ReactSpectrumV3', label: 'React Spectrum v3', accentVar: '--source-v3' },
  { key: 'ReactAria', label: 'React Aria', accentVar: '--source-aria' },
  { key: 'ReactSpectrumReleases', label: 'Release Notes', accentVar: '--source-releases' },
  { key: 'other', label: 'Other', accentVar: '--source-other' },
];

const META_BY_KEY: Record<string, SourceGroupMeta> = Object.fromEntries(
  GROUP_META.map((m) => [m.key, m]),
);

/** Normalize one raw `a:` hit object (as collected by agentStudio.ts) into an
 *  AnswerSource. Hits with neither a url nor a title are dropped upstream by
 *  collectHits already, but we guard again here defensively. */
export function normalizeHit(hit: Record<string, unknown>): AnswerSource | null {
  const title = typeof hit.title === 'string' && hit.title.trim() ? hit.title : undefined;
  const url = typeof hit.url === 'string' && hit.url.trim() ? hit.url : undefined;
  if (!title && !url) return null;
  const source = typeof hit.source === 'string' && hit.source.trim() ? hit.source : undefined;
  const objectId = typeof hit.objectID === 'string' ? hit.objectID : undefined;
  return {
    id: objectId ?? url ?? title ?? crypto.randomUUID(),
    title: title ?? url ?? 'Source',
    url,
    source,
  };
}

/** Classify one source into a known group key (always returns a valid key). */
export function classifySource(s: AnswerSource): string {
  if (s.source && META_BY_KEY[s.source]) return s.source;
  return 'other';
}

/** A stable dedup identity for a source — prefers url (the citation target),
 *  falls back to title. */
function sourceKey(s: AnswerSource): string {
  return (s.url ?? s.title).toLowerCase();
}

/**
 * Group sources by `source` facet into ordered, non-empty groups, deduped
 * within each group (first occurrence wins, order preserved).
 */
export function groupSources(sources: AnswerSource[]): SourceGroup[] {
  const buckets = new Map<string, { sources: AnswerSource[]; seen: Set<string> }>();
  for (const s of sources) {
    const key = classifySource(s);
    let b = buckets.get(key);
    if (!b) {
      b = { sources: [], seen: new Set() };
      buckets.set(key, b);
    }
    const id = sourceKey(s);
    if (b.seen.has(id)) continue;
    b.seen.add(id);
    b.sources.push(s);
  }
  return GROUP_META.filter((m) => buckets.has(m.key)).map((m) => ({
    ...m,
    sources: buckets.get(m.key)!.sources,
  }));
}

/** Total deduped source count across groups. */
export function totalSources(groups: SourceGroup[]): number {
  return groups.reduce((n, g) => n + g.sources.length, 0);
}
