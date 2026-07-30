#!/usr/bin/env node
/**
 * REPAIR CITATION URLS + TITLES for the SpectrumDesignDocs slice of
 * ACS_SPECTRUM_MULTI.
 *
 * THE BUG (found 2026-07-28 by clicking a source pill)
 * -----------------------------------------------------------
 * Every SpectrumDesignDocs record cited `raw.githubusercontent.com/.../x.md` —
 * a plaintext markdown DOWNLOAD, not a readable page. Clicking a source in the
 * chat UI dumped raw markdown at the user. On a prospect-facing demo whose whole
 * claim is "every answer cites its source", the citation has to open something a
 * human can read.
 *
 * Two defects, same records:
 *   1. url   — the FETCH url was stored as the CITATION url.
 *   2. title — stored as the filename slug ("combo-box") when the file's own
 *              frontmatter carries a real title ("Combo box").
 *
 * WHY A REPAIR SCRIPT AND NOT A RE-INGEST
 * ---------------------------------------
 * These 103 records were NOT produced by any checked-in generator: they carry
 * hashed objectIDs and only {url,title,source,body}, whereas
 * `ingest_git_docs.mjs` writes path-based objectIDs plus section/path/bodyLen.
 * Re-ingesting would therefore DUPLICATE the corpus under different objectIDs
 * rather than replace it. So this does an in-place `partialUpdateObject` of two
 * attributes, which is reversible and touches nothing else.
 * `ingest_git_docs.mjs` is fixed in the same commit so a future ingest is
 * correct at the generator.
 *
 * WHERE THE GOOD URL COMES FROM
 * -----------------------------
 * Each markdown file's frontmatter has `source_url:` pointing at
 * `s2.spectrum.corp.adobe.com` — Adobe's INTERNAL host, which does not resolve
 * publicly (measured: curl exit code 000). The public equivalent is
 * `spectrum.adobe.com/page/<slug>/`, which exists for 56 of the 100 slugs.
 *
 * The site is an SPA that answers 200 with a ~6.4KB shell for unknown slugs, so
 * an HTTP status check is worthless here — a soft 404 looks identical to a hit.
 * This verifies a real page by requiring a <title> element, and caches the
 * verdicts so a re-run doesn't re-hammer adobe.com.
 *
 * Slugs with no public page (S2-only components, internal app-frame docs,
 * support pages) fall back to the GitHub BLOB url — the same source we actually
 * ingested, rendered as a readable page instead of a plaintext download.
 *
 *   node scripts/crawler/repair_citation_urls.mjs [--dry] [--recheck]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry');
const RECHECK = ARGV.includes('--recheck');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DOCS = join(ROOT, 'data/spectrum-design-data/docs/s2-docs');
const INDEX = 'ACS_SPECTRUM_MULTI';
const SOURCE = 'SpectrumDesignDocs';
const RAW_PREFIX = 'https://raw.githubusercontent.com/adobe/spectrum-design-data/main/docs/s2-docs/';
const BLOB_PREFIX = 'https://github.com/adobe/spectrum-design-data/blob/main/docs/s2-docs/';
const PUBLIC_PAGE = (slug) => `https://spectrum.adobe.com/page/${slug}/`;

const EVIDENCE_DIR = join(ROOT, 'scripts/crawler/citation-url-evidence');
const CACHE = join(EVIDENCE_DIR, 'public-page-verification.json');
const BASELINE = join(EVIDENCE_DIR, 'baseline-before-repair.json');

// ---------- env ----------
const envPath = [join(ROOT, '.env.local')].find(existsSync);
if (!envPath) { console.error('no .env.local'); process.exit(1); }
const ENV = {};
for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV.ALGOLIA_APP_ID, AKEY = ENV.ALGOLIA_ADMIN_API_KEY;
if (!APP || !AKEY) { console.error('missing ALGOLIA_APP_ID / ALGOLIA_ADMIN_API_KEY'); process.exit(1); }

const aApi = async (method, path, body) => {
  const r = await fetch(`https://${APP}.algolia.net${path}`, {
    method,
    headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': AKEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

// ---------- 1. read the markdown source of truth ----------
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : e.endsWith('.md') && out.push(p);
  }
  return out;
}
/** rel path -> { title, slug } straight from the file's own frontmatter. */
const byRel = new Map();
for (const abs of walk(DOCS)) {
  const raw = readFileSync(abs, 'utf8');
  const rel = relative(DOCS, abs);
  const fm = {};
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  const h1 = (raw.match(/^#\s+(.+)$/m) || [])[1];
  // frontmatter source_url is the internal corp host; we only want its slug.
  const slug = (fm.source_url || '').match(/\/page\/([^/]+)\/?/)?.[1] ?? null;
  byRel.set(rel, { title: fm.title || h1 || rel.replace(/\.md$/, '').split('/').pop(), slug });
}
console.log(`read ${byRel.size} markdown files from ${relative(ROOT, DOCS)}`);

// ---------- 2. verify which public pages actually exist ----------
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
let verified = existsSync(CACHE) && !RECHECK ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

/**
 * A real page has a <title>; spectrum.adobe.com answers 200 with a ~6.4KB SPA
 * shell (no <title>) for any unknown slug, so status codes can't be trusted.
 */
async function publicPageExists(slug) {
  try {
    const res = await fetch(PUBLIC_PAGE(slug), { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const html = await res.text();
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    return { ok: title.trim().length > 0, title: title.trim(), bytes: html.length };
  } catch (e) {
    return { ok: false, title: '', bytes: 0, error: String(e.message ?? e) };
  }
}

const slugs = [...new Set([...byRel.values()].map((v) => v.slug).filter(Boolean))];
const todo = slugs.filter((s) => verified[s] === undefined);
if (todo.length) {
  console.log(`verifying ${todo.length} candidate public page(s) on spectrum.adobe.com …`);
  const CONC = 5; // polite: this hits a third party we don't own
  for (let i = 0; i < todo.length; i += CONC) {
    const batch = todo.slice(i, i + CONC);
    const out = await Promise.all(batch.map(publicPageExists));
    batch.forEach((s, j) => { verified[s] = out[j]; });
    process.stdout.write(`\r  ${Math.min(i + CONC, todo.length)}/${todo.length}`);
  }
  process.stdout.write('\n');
  writeFileSync(CACHE, JSON.stringify(verified, null, 2));
} else {
  console.log(`using cached verification for ${slugs.length} slug(s) (--recheck to redo)`);
}
const liveCount = slugs.filter((s) => verified[s]?.ok).length;
console.log(`  public page EXISTS for ${liveCount}/${slugs.length}; ${slugs.length - liveCount} fall back to the rendered GitHub blob`);

// ---------- 3. read the live records ----------
const hits = [];
for (let page = 0; ; page++) {
  const r = await aApi('POST', `/1/indexes/${INDEX}/query`, {
    query: '', facetFilters: [[`source:${SOURCE}`]], hitsPerPage: 100, page,
    attributesToRetrieve: ['objectID', 'url', 'title'], attributesToHighlight: [],
  });
  hits.push(...(r.json.hits ?? []));
  if (page + 1 >= (r.json.nbPages ?? 1)) break;
}
console.log(`fetched ${hits.length} live ${SOURCE} record(s)`);

// Baseline BEFORE mutating anything, so this is reversible.
if (!existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify({ index: INDEX, source: SOURCE, capturedAt: null, records: hits }, null, 2));
  console.log(`  baseline written -> ${relative(ROOT, BASELINE)} (${hits.length} records)`);
} else {
  console.log(`  baseline already exists -> ${relative(ROOT, BASELINE)} (kept; it is the pre-repair truth)`);
}

// ---------- 4. compute the repair ----------
const updates = [];
const unmatched = [];
for (const h of hits) {
  if (!h.url?.startsWith(RAW_PREFIX)) { unmatched.push(h); continue; }
  const rel = h.url.slice(RAW_PREFIX.length);
  const meta = byRel.get(rel);
  if (!meta) { unmatched.push(h); continue; }
  const url = meta.slug && verified[meta.slug]?.ok ? PUBLIC_PAGE(meta.slug) : `${BLOB_PREFIX}${rel}`;
  if (url === h.url && meta.title === h.title) continue;
  updates.push({ objectID: h.objectID, url, title: meta.title, _was: { url: h.url, title: h.title } });
}
console.log(`\n${updates.length} record(s) need repair; ${unmatched.length} unmatched`);
if (unmatched.length) for (const u of unmatched) console.log(`  UNMATCHED ${u.objectID} ${u.url}`);
for (const u of updates.slice(0, 5)) {
  console.log(`  ${u._was.title}  ->  ${u.title}`);
  console.log(`     ${u._was.url}\n  -> ${u.url}`);
}
const toPublic = updates.filter((u) => u.url.startsWith('https://spectrum.adobe.com')).length;
console.log(`\n  -> public Adobe page: ${toPublic}   -> rendered GitHub blob: ${updates.length - toPublic}`);

if (DRY) { console.log('\n[dry] nothing written to the index.'); process.exit(0); }

// ---------- 5. apply (partial update: only url + title) ----------
const CHUNK = 500;
for (let i = 0; i < updates.length; i += CHUNK) {
  const requests = updates.slice(i, i + CHUNK).map(({ objectID, url, title }) => ({
    action: 'partialUpdateObject', body: { objectID, url, title },
  }));
  const r = await aApi('POST', `/1/indexes/${INDEX}/batch`, { requests });
  console.log(`  batch ${i}-${i + requests.length} -> HTTP ${r.status} taskID=${r.json.taskID ?? JSON.stringify(r.json).slice(0, 80)}`);
}

// ---------- 6. verify the SERVED records, not our intent ----------
await new Promise((r) => setTimeout(r, 4000)); // let indexing settle
const after = await aApi('POST', `/1/indexes/${INDEX}/query`, {
  query: '', facetFilters: [[`source:${SOURCE}`]], hitsPerPage: 100,
  attributesToRetrieve: ['objectID', 'url', 'title'], attributesToHighlight: [],
});
const stillRaw = (after.json.hits ?? []).filter((h) => h.url?.includes('raw.githubusercontent.com'));
console.log(`\n== verify ==  raw .md citations remaining on page 1: ${stillRaw.length}`);
for (const h of (after.json.hits ?? []).slice(0, 3)) console.log(`  ${h.title}  ${h.url}`);
process.exit(stillRaw.length === 0 ? 0 : 1);
