/**
 * sources — normalize raw Agent Studio `a:` hits into AnswerSource, then group
 * by the hit's `source` facet for the pill UI. Ported from
 * _legacy_plaincss/src/lib/sources.ts, with the facet list now read from the
 * active instance's `sourceFacets` config instead of a hardcoded list — that's
 * what lets a new instance bring its own source facets with zero code edits.
 * Pure functions, no DOM, no React.
 */
import { activeInstance } from '../config/active';
import type { AnswerSource } from '../types';

export interface SourceGroupMeta {
  key: string;
  label: string;
}

export interface SourceGroup extends SourceGroupMeta {
  sources: AnswerSource[];
}

/** Display order + presentation, derived from the active instance's
 *  sourceFacets config. Anything else (or a missing facet) buckets to
 *  'other'. */
function groupMeta(): SourceGroupMeta[] {
  return [
    ...activeInstance.sourceFacets.map((f) => ({ key: f.value, label: f.label })),
    { key: 'other', label: 'Other' },
  ];
}

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
export function classifySource(s: AnswerSource, meta: SourceGroupMeta[]): string {
  if (s.source && meta.some((m) => m.key === s.source)) return s.source;
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
  const meta = groupMeta();
  const buckets = new Map<string, { sources: AnswerSource[]; seen: Set<string> }>();
  for (const s of sources) {
    const key = classifySource(s, meta);
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
  return meta.filter((m) => buckets.has(m.key)).map((m) => ({
    ...m,
    sources: buckets.get(m.key)!.sources,
  }));
}

/** Total deduped source count across groups. */
export function totalSources(groups: SourceGroup[]): number {
  return groups.reduce((n, g) => n + g.sources.length, 0);
}

/** Strip the redundant product/version tail from a hit title so the pill shows
 *  just the page name — the facet is already conveyed by the group label.
 *  "CheckboxGroup | React Spectrum" / "CheckboxGroup – V3" → "CheckboxGroup". */
export function cleanTitle(s: AnswerSource): string {
  const t = s.title
    .replace(/\s*[|–-]\s*(React Spectrum(?:\s+(?:S2|V3))?|V3|S2)\s*$/i, '')
    .trim();
  return t || s.title;
}

/** A changelog / release-notes page — low-value as a cited "source", so the UI
 *  collapses these into a single "+N release notes" count per group instead of
 *  one pill each. Detected by url path or a dated "… Release" title. */
export function isReleaseNote(s: AnswerSource): boolean {
  if (s.url && /\/releases?\//i.test(s.url)) return true;
  return /\brelease\b/i.test(s.title) && /\b(19|20)\d{2}\b/.test(s.title);
}
