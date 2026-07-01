#!/usr/bin/env node
/**
 * SELF-FETCH HTML CRAWLER — for un-owned docs sections with NO clean .md twins (e.g.
 * react-spectrum.adobe.com/v3/). BFS same-origin links under a path scope, fetch each
 * page's static HTML (server-rendered), extract the <main>/<article> text, push records.
 * Bypasses the native crawler's domain-ownership gate (we fetch + index ourselves).
 *
 *   node crawl_html.mjs --seed https://react-spectrum.adobe.com/v3/Button.html \
 *        --scope /v3/ --source ReactSpectrumV3 --index ACS_SPECTRUM_MULTI [--max 300] [--dry]
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const A = {};
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); A[k] = (i + 1 < a.length && !a[i + 1].startsWith('--')) ? a[++i] : true; } }
for (const r of ['seed', 'scope', 'source', 'index']) if (!A[r]) { console.error(`required: --${r}`); process.exit(1); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [A.env, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean).find((p) => existsSync(p));
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const APP = ENV.ALGOLIA_APP_ID, AKEY = ENV.ALGOLIA_ADMIN_API_KEY;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ACS-docs-fetch)' };
const MAX = Number(A.max || 500), CAP = 90000;
const seed = new URL(A.seed), ORIGIN = seed.origin;

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
function extract(html, url) {
  const noChrome = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ').replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ').replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s*[–|]\s*React Spectrum.*$/i, '');
  const h1 = clean((noChrome.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]*>/g, ''));
  const region = (noChrome.match(/<main[^>]*>([\s\S]*?)<\/main>/i) || noChrome.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || [])[1] || '';
  let body = clean(region.replace(/<[^>]*>/g, ' '));
  if (Buffer.byteLength(body) > CAP) body = body.slice(0, CAP);
  const path = new URL(url).pathname.replace(/^\//, '');
  return { objectID: `${A.source}/${path}`, url, source: A.source, section: A.source, title: title || h1 || path, h1, body, bodyLen: body.length };
}
function links(html, fromUrl) {
  const out = new Set();
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    try { const u = new URL(m[1], fromUrl); if (u.origin === ORIGIN && u.pathname.startsWith(A.scope) && /\.html$/.test(u.pathname)) out.add(u.href.split('#')[0]); } catch { /* */ }
  }
  return [...out];
}

// BFS with bounded concurrency, follows redirects, dedups by final URL
const seen = new Set(), records = [], queue = [A.seed];
let active = 0, idx = 0;
async function worker() {
  while (idx < queue.length && records.length < MAX) {
    const url = queue[idx++];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetch(url, { headers: UA, redirect: 'follow' });
      const final = res.url.split('#')[0];
      if (final !== url && seen.has(final)) continue;
      seen.add(final);
      const html = await res.text();
      const rec = extract(html, final);
      if (rec.bodyLen >= 40) records.push(rec);
      for (const l of links(html, final)) if (!seen.has(l) && !queue.includes(l)) queue.push(l);
    } catch (e) { /* skip page on error */ }
  }
}
console.log(`BFS crawl seed=${A.seed} scope=${A.scope} origin=${ORIGIN}`);
await Promise.all(Array.from({ length: 6 }, worker));
const lens = records.map((r) => r.bodyLen).sort((a, b) => a - b);
console.log(`crawled ${records.length} pages (visited ${seen.size}) · median body=${lens[Math.floor(lens.length / 2)] || 0}ch · empty=${records.filter((r) => r.bodyLen < 40).length}`);
console.log('  sample:', JSON.stringify({ ...records[0], body: (records[0]?.body || '').slice(0, 120) + '…' }).slice(0, 350));

if (A.dry) { console.log('\n[dry] not indexing.'); process.exit(0); }
async function aApi(method, path, body) { const r = await fetch(`https://${APP}.algolia.net${path}`, { method, headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': AKEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; }
for (let i = 0; i < records.length; i += 50) { const b = records.slice(i, i + 50).map((body) => ({ action: 'updateObject', body })); const r = await aApi('POST', `/1/indexes/${A.index}/batch`, { requests: b }); console.log(`  batch ${i}-${i + b.length} -> HTTP ${r.status}`); }
const c = await aApi('POST', `/1/indexes/${A.index}/query`, { query: '', hitsPerPage: 0, facets: ['source'] });
console.log(`\n== done ==  index=${A.index}  nbHits=${c.json.nbHits}  facets=${JSON.stringify(c.json.facets?.source)}`);
