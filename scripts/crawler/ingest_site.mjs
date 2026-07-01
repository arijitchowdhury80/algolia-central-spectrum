#!/usr/bin/env node
/**
 * SELF-FETCH INGESTER (docs website we DON'T own) — bypasses the native Algolia Crawler's
 * domain-ownership gate (RUNBOOK #17) by fetching pages ourselves and pushing records via
 * the indexing API. No domain gate applies to indexing.
 *
 * DISCOVERY: prefers `llms.txt` (the emerging LLM-friendly doc index — a markdown list of
 * `- [Title](path.md): description`). Many modern doc sites (incl. react-spectrum.adobe.com)
 * ALSO publish a clean `.md` twin of every page — we fetch those directly (no HTML scraping,
 * no JS render). Falls back to a plain --urls list.
 *
 * Usage:
 *   node ingest_site.mjs --llms https://react-spectrum.adobe.com/llms.txt \
 *        --source ReactSpectrumS2 --index ACS_SPECTRUM_MULTI [--max 200] [--dry]
 *   node ingest_site.mjs --urls url1,url2 --base https://site.com --source X --index Y
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const A = {};
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); A[k] = (i + 1 < a.length && !a[i + 1].startsWith('--')) ? a[++i] : true; } }
if (!A.llms && !A.urls) { console.error('required: --llms <llms.txt url> OR --urls <csv>'); process.exit(1); }
for (const r of ['source', 'index']) if (!A[r]) { console.error(`required: --${r}`); process.exit(1); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [A.env, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean).find((p) => existsSync(p));
if (!envPath) { console.error('no .env.local found'); process.exit(1); }
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const APP = ENV.ALGOLIA_APP_ID, AKEY = ENV.ALGOLIA_ADMIN_API_KEY;
if (!APP || !AKEY) { console.error('missing ALGOLIA_APP_ID/ALGOLIA_ADMIN_API_KEY'); process.exit(1); }

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ACS-docs-fetch)' };
const MAX = Number(A.max || 1000);

// ---------- 1. DISCOVER: build the fetch list {title, mdUrl, canonicalUrl, description} ----------
async function discover() {
  if (A.urls) {
    const base = A.base ? new URL(A.base) : null;
    return A.urls.split(',').map((u) => { const abs = base ? new URL(u, base).href : u; return { title: '', mdUrl: abs, canonicalUrl: abs, description: '' }; });
  }
  const llmsUrl = new URL(A.llms);
  const txt = await fetch(llmsUrl, { headers: UA }).then((r) => r.text());
  const out = [];
  const re = /^\s*-\s*\[([^\]]+)\]\(([^)]+\.md)\)\s*:?\s*(.*)$/gm;
  let m;
  while ((m = re.exec(txt))) {
    const [, title, rel, description] = m;
    const mdUrl = new URL(rel, llmsUrl).href;
    const canonicalUrl = mdUrl.replace(/\.md$/, '.html');
    out.push({ title, mdUrl, canonicalUrl, description: description.trim() });
  }
  return out;
}

// ---------- 2. FETCH each .md → record (bounded concurrency, polite) ----------
function mdToText(raw) {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '') // frontmatter
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|]/g, ' ').replace(/\s+/g, ' ').trim();
}
async function fetchRecord(item) {
  try {
    const raw = await fetch(item.mdUrl, { headers: UA }).then((r) => r.ok ? r.text() : '');
    if (!raw) return null;
    const path = new URL(item.canonicalUrl).pathname.replace(/^\//, '');
    const body = mdToText(raw);
    const title = item.title || (raw.match(/^#\s+(.+)$/m) || [])[1] || path;
    return { objectID: `${A.source}/${path}`, url: item.canonicalUrl, source: A.source, section: A.source, title, description: item.description, body, bodyLen: body.length };
  } catch { return null; }
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }));
  return out;
}

const list = (await discover()).slice(0, MAX);
console.log(`discovered ${list.length} docs (source=${A.source})`);
if (!list.length) { console.error('nothing discovered — check --llms format'); process.exit(1); }

const records = (await pool(list, 8, fetchRecord)).filter(Boolean);
const lens = records.map((r) => r.bodyLen).sort((a, b) => a - b);
console.log(`fetched ${records.length}/${list.length} · median body=${lens[Math.floor(lens.length / 2)]}ch · near-empty(<40)=${records.filter((r) => r.bodyLen < 40).length}`);
console.log('  sample:', JSON.stringify({ ...records[0], body: records[0]?.body.slice(0, 100) + '…' }).slice(0, 400));

if (A.dry) { console.log('\n[dry] not indexing.'); process.exit(0); }

// ---------- 3. INDEX (no domain gate) ----------
async function aApi(method, path, body) {
  const r = await fetch(`https://${APP}.algolia.net${path}`, { method, headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': AKEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
for (let i = 0; i < records.length; i += 1000) {
  const batch = records.slice(i, i + 1000).map((body) => ({ action: 'updateObject', body }));
  const r = await aApi('POST', `/1/indexes/${A.index}/batch`, { requests: batch });
  console.log(`  batch ${i}-${i + batch.length} -> HTTP ${r.status}`);
}
const s = await aApi('PUT', `/1/indexes/${A.index}/settings`, {
  searchableAttributes: ['title', 'unordered(body)', 'unordered(description)'],
  attributesForFaceting: ['searchable(source)', 'searchable(section)'],
});
console.log(`  setSettings -> HTTP ${s.status}`);
const c = await aApi('POST', `/1/indexes/${A.index}/query`, { query: '', hitsPerPage: 0, facets: ['source'] });
console.log(`\n== done ==  index=${A.index}  nbHits=${c.json.nbHits}  facets=${JSON.stringify(c.json.facets?.source)}  (keyword; neural = phase 2)`);
