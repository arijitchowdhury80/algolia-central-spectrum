/**
 * sources — normalize raw Agent Studio `a:` hits into AnswerSource, then group
 * by the hit's `source` facet for the pill UI. The facet list comes from the
 * active instance's `sourceFacets` config, so a new instance brings its own
 * source facets with zero code edits. Pure functions, no DOM, no React.
 */
import { activeInstance } from '../../config/active';
import type { AnswerSource } from '../types';

export interface SourceGroupMeta {
  key: string;
  label: string;
}

export interface SourceGroup extends SourceGroupMeta {
  sources: AnswerSource[];
}

function groupMeta(): SourceGroupMeta[] {
  return [
    ...activeInstance.sourceFacets.map((f) => ({ key: f.value, label: f.label })),
    { key: 'other', label: activeInstance.strings.sources.fallbackGroup },
  ];
}

function extractStringField(hit: Record<string, unknown>, field: string): string | undefined {
  const v = hit[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function resolveHitId(
  objectId: string | undefined,
  url: string | undefined,
  title: string | undefined,
): string {
  return objectId ?? url ?? title ?? crypto.randomUUID();
}

/** Normalize one raw `a:` hit object into an AnswerSource.
 *  Returns null for hits with neither url nor title. */
export function normalizeHit(hit: Record<string, unknown>): AnswerSource | null {
  const title = extractStringField(hit, 'title');
  const url = extractStringField(hit, 'url');
  if (!title && !url) return null;
  const source = extractStringField(hit, 'source');
  const objectId = typeof hit.objectID === 'string' ? hit.objectID : undefined;
  return {
    id: resolveHitId(objectId, url, title),
    title: title ?? url ?? activeInstance.strings.sources.fallbackTitle,
    url,
    source,
  };
}

export function facetForHit(s: AnswerSource, meta: SourceGroupMeta[]): string {
  if (s.source && meta.some((m) => m.key === s.source)) return s.source;
  return 'other';
}

function sourceKey(s: AnswerSource): string {
  return (s.url ?? s.title).toLowerCase();
}

/** Group sources by `source` facet into ordered, non-empty groups, deduped
 *  within each group (first occurrence wins). */
export function groupSources(sources: AnswerSource[]): SourceGroup[] {
  const meta = groupMeta();
  const buckets = new Map<string, { sources: AnswerSource[]; seen: Set<string> }>();
  for (const s of sources) {
    const key = facetForHit(s, meta);
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
  return meta
    .filter((m) => buckets.has(m.key))
    .map((m) => ({
      ...m,
      sources: buckets.get(m.key)!.sources,
    }));
}

/** Total deduped source count across groups. */
export function totalSources(groups: SourceGroup[]): number {
  return groups.reduce((n, g) => n + g.sources.length, 0);
}

/** Strip redundant product/version tail from a hit title so pill shows just
 *  the page name — the facet is already conveyed by the group label. */
export function cleanTitle(s: AnswerSource): string {
  const t = s.title.replace(/\s*[|–-]\s*(React Spectrum(?:\s+(?:S2|V3))?|V3|S2)\s*$/i, '').trim();
  return t || s.title;
}

/** A changelog/release-notes page — collapses into a "+N release notes" count
 *  instead of one pill each. Detected by URL path or dated title. */
export function isReleaseNote(s: AnswerSource): boolean {
  if (s.url && /\/releases?\//i.test(s.url)) return true;
  return /\brelease\b/i.test(s.title) && /\b(19|20)\d{2}\b/.test(s.title);
}
