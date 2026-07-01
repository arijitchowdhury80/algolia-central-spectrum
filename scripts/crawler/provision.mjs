#!/usr/bin/env node
/**
 * ONE-CLICK CRAWLER PROVISIONER — point at a link + domain, get a populated Algolia index.
 *
 * Generalizes the AC2 crawler-army (scripts/setup/enrich/{shards,army}.mjs) into a single
 * corpus-agnostic command. Source of truth for the mechanism + every failure-fix:
 *   Algolia-Central2/docs/planning/crawler-army-RUNBOOK.md  (verified Crawler REST read-receipt).
 *
 * What it does, in order (the operator-board flow):
 *   1. SEED   — resolve the target's sitemap(s) from robots.txt + common paths (RUNBOOK #6:
 *               never rely on startUrl link-following for coverage). Falls back to startUrl.
 *   2. CONFIG — build a crawler config with the hardened generic deep-body extractor
 *               (RUNBOOK #10/#13 fixes: no $('body') fallback, largest-clean-block, chrome scrub).
 *   3. CREATE — create (or patch) one native Algolia Crawler, idempotent by name.
 *   4. INDEX  — the crawler creates the index on reindex; we then set searchable attributes
 *               so body is queryable immediately (KEYWORD mode). NEURAL = phase 2 (events, RUNBOOK #11).
 *   5. CRAWL  — reindex (pause-first if the crawler is running — RUNBOOK #12).
 *   6. POLL   — watch until reindexing=false, network-fault-tolerant (RUNBOOK #8); report coverage.
 *
 * Usage:
 *   node provision.mjs --url https://site.com/docs [--domain site.com] [--index ACS_SITE_DOCS]
 *                      [--prefix ACS] [--max 2000] [--render false] [--paths 'https://site.com/docs/**']
 *                      [--create-only] [--dry] [--env /path/.env.local]
 *   node provision.mjs --url ... --poll-only     # just poll an already-started crawl
 *   node provision.mjs --url ... --status        # one-shot status
 *
 * Env (.env.local): ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, CRAWLER_USER_ID, CRAWLER_API_KEY.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------- args ----------
const A = {};
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = (i + 1 < a.length && !a[i + 1].startsWith('--')) ? a[++i] : true;
      A[k] = v;
    }
  }
}
if (!A.url) { console.error('required: --url <seed>. See header for usage.'); process.exit(1); }

// ---------- env ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
const envCandidates = [A.env, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean);
const envPath = envCandidates.find((p) => existsSync(p));
if (!envPath) { console.error(`no .env.local found (tried: ${envCandidates.join(', ')})`); process.exit(1); }
const ENV = {};
for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV.ALGOLIA_APP_ID, AKEY = ENV.ALGOLIA_ADMIN_API_KEY;
const CU = ENV.CRAWLER_USER_ID, CK = ENV.CRAWLER_API_KEY;
if (!APP || !AKEY || !CU || !CK) { console.error('missing one of ALGOLIA_APP_ID/ALGOLIA_ADMIN_API_KEY/CRAWLER_USER_ID/CRAWLER_API_KEY'); process.exit(1); }

// ---------- derive names ----------
const seed = new URL(A.url);
const origin = seed.origin;
const domain = A.domain || seed.hostname;
const slug = (s) => s.replace(/^www\./, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
const firstSeg = seed.pathname.split('/').filter(Boolean)[0];
const prefix = A.prefix || 'ACS';
const INDEX = A.index || [prefix, slug(domain), firstSeg ? slug(firstSeg) : ''].filter(Boolean).join('_');
const CRAWLER = INDEX + '_CRAWLER';
const seedPath = seed.pathname.replace(/\/$/, '');
const PATHS = A.paths ? [A.paths] : (seedPath ? [`${origin}${seedPath}/**`, `${origin}${seedPath}`] : [`${origin}/**`]);
const MAX = Number(A.max || 2000);
let RENDER = String(A.render) === 'true';
const IDS_PATH = join(process.cwd(), 'crawler_ids.json');

// ---------- hardened generic deep-body extractor (RUNBOOK #10/#13) ----------
const GENERIC_EXTRACTOR = `({ $, url }) => {
  $('nav,header,footer,aside,script,style,noscript,[role="navigation"],[role="banner"],.sidebar,.breadcrumb,.toc,.cookie,.newsletter,[class*="refinement-list"],[class*="facet-list"]').remove();
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const scrub = (s) => clean(s).replace(/(?:[A-Z][A-Za-z ]+ \\(\\d{1,5}\\)\\s*){3,}/g, ' ').trim();
  const isJunk = (s) => /Show All Other Types/.test(s);
  const title = clean($('head > title').text());
  const h1 = clean($('h1:first-of-type').text());
  const metaDescription = clean($("head > meta[name='description']").attr('content'));
  let best = '';
  $('main, article, [class*="richtext" i], .rich-text, [role=main], .prose, .doc-content, .post-content, .entry-content, .article-body, .markdown, .content').each((i, el) => {
    const t = clean($(el).text());
    if (t.length > best.length && !isJunk(t)) best = t;
  });
  let body = scrub(best);
  const path = url.pathname.replace(/\\/$/, '') || '/';
  if ((!body || isJunk(body)) && !title) return [];
  if (isJunk(body)) body = '';
  return [{ objectID: path, url: path, title, h1, metaDescription, body, bodyLen: body.length, crawledFrom: url.href }];
}`;

function buildConfig(sitemaps) {
  return {
    appId: APP, apiKey: AKEY, indexPrefix: '', rateLimit: 8,
    renderJavaScript: RENDER,
    ignoreQueryParams: ['ref', 'utm_'],
    maxUrls: MAX,
    startUrls: [A.url],
    sitemaps,
    exclusionPatterns: ['**/deprecated/**', '**/careers/**', '**/greenhouse.io/**'], // RUNBOOK #16 Careers trap
    actions: [{ indexName: INDEX, pathsToMatch: PATHS, recordExtractor: { __type: 'function', source: GENERIC_EXTRACTOR } }],
  };
}

// ---------- api clients (fault-tolerant, RUNBOOK #8) ----------
const cAuth = 'Basic ' + Buffer.from(`${CU}:${CK}`).toString('base64');
async function cApi(p, o = {}) {
  for (let a = 0; a < 4; a++) {
    try { return await fetch('https://crawler.algolia.com/api/1' + p, { ...o, headers: { Authorization: cAuth, 'Content-Type': 'application/json', ...(o.headers || {}) } }); }
    catch (e) { if (a === 3) throw e; await new Promise((r) => setTimeout(r, 2000 * (a + 1))); }
  }
}
async function aApi(method, path, body) {
  const r = await fetch(`https://${APP}.algolia.net${path}`, { method, headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': AKEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. SEED: resolve sitemaps ----------
async function resolveSitemaps() {
  const found = new Set();
  try {
    const rb = await fetch(`${origin}/robots.txt`).then((r) => r.ok ? r.text() : '').catch(() => '');
    for (const line of rb.split('\n')) { const m = line.match(/^\s*Sitemap:\s*(\S+)/i); if (m) found.add(m[1].trim()); }
  } catch { /* */ }
  for (const cand of [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-lang.xml`, `${origin}${seedPath}/sitemap.xml`]) {
    try { const r = await fetch(cand); const ct = r.headers.get('content-type') || ''; const txt = r.ok ? await r.text() : ''; if (r.ok && (ct.includes('xml') || txt.includes('<urlset') || txt.includes('<sitemapindex'))) found.add(cand); }
    catch { /* */ }
  }
  return [...found];
}

// ---------- crawler helpers ----------
async function findCrawlerId() {
  const list = await (await cApi('/crawlers?itemsPerPage=100')).json();
  const hit = (list.items || []).find((c) => c.name === CRAWLER);
  return hit?.id;
}
async function getStatus(id) { return (await cApi(`/crawlers/${id}`)).json(); }
async function urlStats(id) { return (await cApi(`/crawlers/${id}/stats/urls`)).json().catch(() => ({})); }
async function staged() { const r = await aApi('POST', `/1/indexes/${INDEX}/query`, { query: '', hitsPerPage: 0 }); return r.json.nbHits ?? null; }

async function createOrPatch(sitemaps) {
  const cfg = buildConfig(sitemaps);
  let id = await findCrawlerId();
  if (id) {
    const r = await cApi(`/crawlers/${id}/config`, { method: 'PATCH', body: JSON.stringify(cfg) });
    console.log(`  PATCH crawler ${CRAWLER} (${id}) -> HTTP ${r.status}`);
  } else {
    const r = await cApi('/crawlers', { method: 'POST', body: JSON.stringify({ name: CRAWLER, config: cfg }) });
    const j = await r.json(); id = j.id;
    console.log(`  CREATE crawler ${CRAWLER} -> HTTP ${r.status}  id=${id || JSON.stringify(j).slice(0, 200)}`);
    if (!id) process.exit(1);
  }
  const ids = existsSync(IDS_PATH) ? JSON.parse(readFileSync(IDS_PATH, 'utf8')) : {};
  ids[INDEX] = id; writeFileSync(IDS_PATH, JSON.stringify(ids, null, 2));
  return id;
}

async function startCrawl(id) {
  const st = await getStatus(id);
  if (st.running) { // RUNBOOK #12: pause-then-reindex
    console.log('  crawler running -> pause first');
    await cApi(`/crawlers/${id}/pause`, { method: 'POST' });
    for (let i = 0; i < 30; i++) { if (!(await getStatus(id)).running) break; await sleep(3000); }
  }
  const r = await cApi(`/crawlers/${id}/reindex`, { method: 'POST' });
  console.log(`  REINDEX -> HTTP ${r.status}`);
}

async function poll(id) {
  for (let i = 0; i < 360; i++) {
    try {
      const st = await getStatus(id);
      const s = await urlStats(id);
      const done = (s.data || []).filter((d) => d.category === 'success').reduce((a, d) => a + d.count, 0);
      console.log(`  [${i}] reindexing=${st.reindexing} running=${st.running} success=${done}/${s.count ?? '?'} staged=${await staged()}`);
      if (!st.reindexing) { console.log('  CRAWL DONE.'); return true; }
    } catch (e) { console.log(`  [${i}] transient (ignored): ${e.message}`); }
    await sleep(10000);
  }
  console.log('  poll timeout — re-run with --poll-only.');
  return false;
}

async function configureIndex() {
  // make body queryable immediately (KEYWORD). NEURAL = phase 2 (events replay, RUNBOOK #11).
  const r = await aApi('PUT', `/1/indexes/${INDEX}/settings`, {
    searchableAttributes: ['title', 'h1', 'unordered(body)', 'unordered(metaDescription)', 'url'],
    attributesForFaceting: ['searchable(url)'],
  });
  console.log(`  setSettings ${INDEX} -> HTTP ${r.status}`);
}

// ---------- run ----------
console.log(`\n== one-click provision ==`);
console.log(`  seed=${A.url}\n  domain=${domain}\n  index=${INDEX}\n  crawler=${CRAWLER}\n  paths=${JSON.stringify(PATHS)}\n  maxUrls=${MAX} renderJS=${RENDER}\n  app=${APP} env=${envPath}`);

const id0 = await findCrawlerId();
if (A.status) { console.log(id0 ? JSON.stringify(await getStatus(id0), null, 2) : 'crawler not created yet'); process.exit(0); }
if (A['poll-only']) { if (!id0) { console.error('crawler not found'); process.exit(1); } await poll(id0); process.exit(0); }

console.log('\n[1] SEED — resolving sitemaps…');
const sitemaps = await resolveSitemaps();
console.log(sitemaps.length ? `  found ${sitemaps.length}: ${sitemaps.join(', ')}` : '  none found — falling back to startUrl link-following (coverage risk, RUNBOOK #6).');

// PRE-FLIGHT: detect JS-rendered SPA (tiny static body). If so + no sitemap and --render not set
// explicitly, auto-enable renderJavaScript so the crawl captures real content, not the app shell.
if (A.render === undefined) {
  try {
    const html = await fetch(A.url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then((r) => r.text());
    const staticLen = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length;
    if (staticLen < 800) { RENDER = true; console.log(`  pre-flight: static body only ${staticLen} chars -> JS-rendered SPA. Auto-enabling renderJavaScript:true.`); }
    else { console.log(`  pre-flight: static body ${staticLen} chars -> server-rendered, renderJavaScript:false ok.`); }
  } catch { /* */ }
}

if (A.dry) { console.log('\n[dry] config:\n' + JSON.stringify(buildConfig(sitemaps), null, 2)); process.exit(0); }

// DOMAIN ALLOW-LIST PRE-CHECK (Algolia anti-abuse gate). The crawler rejects startUrls whose
// domain isn't verified for the account. Fail fast with the verified list + how to fix, instead
// of a raw 400 on create.
async function assertDomainAllowed() {
  const list = await (await cApi('/domains')).json().catch(() => ({ items: [] }));
  const verified = (list.items || []).filter((d) => d.verified).map((d) => d.domain);
  const match = (dom, pat) => pat === dom || (pat.startsWith('*.') && dom.endsWith(pat.slice(1))) || (pat.startsWith('*') && dom.endsWith(pat.slice(1)));
  const ok = verified.some((p) => match(domain, p));
  if (!ok) {
    console.error(`\n  ✖ BLOCKED: domain "${domain}" is not verified for the crawler account.`);
    console.error(`    Algolia Crawler only crawls domains you've proven you own (anti-abuse).`);
    console.error(`    Verified domains available: ${verified.join(', ') || '(none)'}`);
    console.error(`    Fix (one-time, dashboard): Crawler → Domains → Add "${domain}" → verify via meta tag / DNS TXT / HTML file.`);
    console.error(`    Then re-run this command. (No public API to add+verify a domain — POST/PUT /domains 404.)`);
    process.exit(2);
  }
  console.log(`  domain "${domain}" verified for the account ✓`);
}

console.log('\n[2/3] CONFIG + CREATE…');
await assertDomainAllowed();
const id = await createOrPatch(sitemaps);

if (A['create-only']) { console.log('\n--create-only: crawler ready, not crawling.'); process.exit(0); }

console.log('\n[4] INDEX — configuring searchable attributes…');
await configureIndex();

console.log('\n[5] CRAWL — reindex…');
await startCrawl(id);

console.log('\n[6] POLL…');
await poll(id);

console.log(`\n== done ==  index=${INDEX}  (neural activation = phase 2: events replay, RUNBOOK #11)`);
