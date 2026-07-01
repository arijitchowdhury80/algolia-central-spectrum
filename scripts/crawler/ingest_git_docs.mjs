#!/usr/bin/env node
/**
 * SELF-FETCH INGESTER (git markdown docs) — for corpora we DON'T own, where the native
 * Algolia Crawler is blocked by its domain-ownership gate (RUNBOOK #17). We fetch the
 * content ourselves (a cloned repo) and push records via the standard Algolia indexing
 * API (saveObjects) — no domain gate applies to indexing.
 *
 * Reads all *.md under <repo>/<subdir>, one record per file:
 *   { objectID, url, source, section, title, body, bodyLen }
 * then batch-indexes into <index> and sets searchable attributes + source/section facets.
 *
 * Usage:
 *   node ingest_git_docs.mjs --repo data/spectrum-design-data --subdir docs/s2-docs \
 *        --source SpectrumDesignDocs --index ACS_SPECTRUM_MULTI \
 *        --urlbase https://github.com/adobe/spectrum-design-data/blob/main/docs/s2-docs [--dry]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const A = {};
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); A[k] = (i + 1 < a.length && !a[i + 1].startsWith('--')) ? a[++i] : true; } }
for (const r of ['repo', 'subdir', 'source', 'index']) if (!A[r]) { console.error(`required: --${r}`); process.exit(1); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [A.env, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean).find((p) => existsSync(p));
if (!envPath) { console.error('no .env.local found'); process.exit(1); }
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const APP = ENV.ALGOLIA_APP_ID, AKEY = ENV.ALGOLIA_ADMIN_API_KEY;
if (!APP || !AKEY) { console.error('missing ALGOLIA_APP_ID/ALGOLIA_ADMIN_API_KEY'); process.exit(1); }

const base = join(A.repo, A.subdir);
if (!existsSync(base)) { console.error(`not found: ${base}`); process.exit(1); }

// walk *.md
function walk(dir, out = []) { for (const e of readdirSync(dir)) { const p = join(dir, e); const st = statSync(p); if (st.isDirectory()) walk(p, out); else if (e.endsWith('.md')) out.push(p); } return out; }
const files = walk(base);

// parse one markdown file → record
function toRecord(abs) {
  const raw = readFileSync(abs, 'utf8');
  const rel = relative(base, abs);
  let fm = {}, body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) { for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); } body = raw.slice(m[0].length); }
  const h1 = (body.match(/^#\s+(.+)$/m) || [])[1];
  const title = fm.title || h1 || rel.replace(/\.md$/, '').split('/').pop().replace(/[-_]/g, ' ');
  const clean = body.replace(/```[\s\S]*?```/g, (b) => ' ' + b.replace(/```\w*/g, '').replace(/```/g, '') + ' ') // keep code text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // strip images, keep link text
    .replace(/[#>*_`|]/g, ' ').replace(/\s+/g, ' ').trim();
  const section = rel.includes('/') ? rel.split('/')[0] : 'root';
  return {
    objectID: `${A.subdir}/${rel}`,
    url: A.urlbase ? `${A.urlbase}/${rel}` : undefined,
    source: A.source, section, title,
    body: clean, bodyLen: clean.length,
    path: rel,
  };
}
const records = files.map(toRecord);
const stats = { n: records.length, empty: records.filter((r) => r.bodyLen < 40).length, medianLen: records.map((r) => r.bodyLen).sort((a, b) => a - b)[Math.floor(records.length / 2)] };
console.log(`parsed ${stats.n} md files from ${base}`);
console.log(`  source=${A.source} · median body=${stats.medianLen}ch · near-empty(<40ch)=${stats.empty}`);
console.log('  sample:', JSON.stringify({ ...records[0], body: records[0].body.slice(0, 120) + '…' }, null, 0).slice(0, 400));

if (A.dry) { console.log('\n[dry] not indexing.'); process.exit(0); }

// index via Algolia API (no domain gate — we push records ourselves)
async function aApi(method, path, body) {
  const r = await fetch(`https://${APP}.algolia.net${path}`, { method, headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': AKEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
// batch saveObjects (addObject; objectID present so it upserts)
const CHUNK = 1000;
for (let i = 0; i < records.length; i += CHUNK) {
  const batch = records.slice(i, i + CHUNK).map((body) => ({ action: 'updateObject', body }));
  const r = await aApi('POST', `/1/indexes/${A.index}/batch`, { requests: batch });
  console.log(`  batch ${i}-${i + batch.length} -> HTTP ${r.status} taskID=${r.json.taskID ?? JSON.stringify(r.json).slice(0, 120)}`);
}
const s = await aApi('PUT', `/1/indexes/${A.index}/settings`, {
  searchableAttributes: ['title', 'unordered(body)'],
  attributesForFaceting: ['searchable(source)', 'searchable(section)'],
});
console.log(`  setSettings -> HTTP ${s.status}`);
const cnt = await aApi('POST', `/1/indexes/${A.index}/query`, { query: '', hitsPerPage: 0 });
console.log(`\n== done ==  index=${A.index}  nbHits=${cnt.json.nbHits}  (keyword mode; neural = phase 2 events)`);
