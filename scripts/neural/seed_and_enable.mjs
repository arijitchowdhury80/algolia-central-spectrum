#!/usr/bin/env node
/**
 * Neural activation for ACS_SPECTRUM_MULTI (ported from AC2 seed_neural_events + enable_neural).
 * A FRESH index PUT mode:neuralSearch returns 412 "SemanticSearch: no events" — so we first push a
 * relevance-faithful event stream (click/convert on the genuine top hits for real Spectrum queries),
 * let aggregation run (async), then PUT mode:neuralSearch. Aggregation can lag; re-run `enable` later.
 *
 *   node seed_and_enable.mjs seed     # push events
 *   node seed_and_enable.mjs enable   # attempt PUT mode:neuralSearch (poll)
 *   node seed_and_enable.mjs          # seed then enable
 *
 * Read receipt (AC2 docs/algolia-api/06): POST /1/events @ insights.algolia.io; click-after-search
 * needs eventType,eventName,index,userToken,objectIDs,queryID,positions (len==objectIDs); queryID
 * from search w/ clickAnalytics:true; <=1000 events/req.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean).find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const APP = ENV.ALGOLIA_APP_ID, KEY = ENV.ALGOLIA_ADMIN_API_KEY;
const INDEX = 'ACS_SPECTRUM_MULTI';
const SEARCH = `https://${APP}.algolia.net`, INSIGHTS = 'https://insights.algolia.io';

async function call(host, method, path, body) {
  const r = await fetch(`${host}${path}`, { method, headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t }; } return { status: r.status, json: j };
}
async function mapLimit(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

const QUERIES = [
  'button', 'action button', 'accordion', 'color swatch', 'color picker', 'date picker', 'date field', 'calendar',
  'combobox', 'dialog', 'alert dialog', 'menu', 'action menu', 'popover', 'table', 'tabs', 'tooltip', 'checkbox',
  'checkbox group', 'radio group', 'slider', 'text field', 'text area', 'number field', 'search field', 'toast',
  'tag group', 'card', 'card view', 'avatar', 'badge', 'breadcrumbs', 'drag and drop', 'drop zone', 'forms',
  'accessibility', 'theming', 'styling', 'icons', 'illustrations', 'layout', 'press event onPress', 'keyboard navigation',
  'selection', 'collections', 'internationalization', 'disabled state', 'validation', 'progress bar', 'progress circle',
  'switch', 'link', 'divider', 'pagination', 'tree view', 'list box', 'list view', 'picker', 'segmented control',
  'contextual help', 'inline alert', 'meter', 'status light', 'toggle button', 'color wheel', 'color area',
];
const USERS = Array.from({ length: 10 }, (_, i) => `acs-seed-user-${i}`);

async function seed() {
  console.log(`=== seeding events → ${INDEX} ===`);
  const tasks = []; for (const u of USERS) for (const q of QUERIES) tasks.push({ u, q });
  let searched = 0;
  const events = (await mapLimit(tasks, 12, async ({ u, q }) => {
    const s = await call(SEARCH, 'POST', `/1/indexes/${INDEX}/query`, { query: q, clickAnalytics: true, hitsPerPage: 5 });
    const qid = s.json.queryID, hits = s.json.hits ?? [];
    if (!qid || !hits.length) return [];
    searched++;
    const ev = [{ eventType: 'click', eventName: 'Result Clicked', index: INDEX, userToken: u, queryID: qid, objectIDs: [hits[0].objectID], positions: [1] }];
    if (Math.abs(hashStr(u + q)) % 10 < 4) ev.push({ eventType: 'conversion', eventName: 'Result Saved', index: INDEX, userToken: u, queryID: qid, objectIDs: [hits[0].objectID] });
    if (hits[1] && Math.abs(hashStr(q + u)) % 10 < 3) ev.push({ eventType: 'click', eventName: 'Result Clicked', index: INDEX, userToken: u, queryID: qid, objectIDs: [hits[1].objectID], positions: [2] });
    return ev;
  })).flat();
  console.log(`  ${searched}/${tasks.length} searches hit → ${events.length} events`);
  let pushed = 0;
  for (let i = 0; i < events.length; i += 1000) { const slice = events.slice(i, i + 1000); const ins = await call(INSIGHTS, 'POST', '/1/events', { events: slice }); if (ins.status === 200) pushed += slice.length; else console.log(`  push → HTTP ${ins.status} ${JSON.stringify(ins.json).slice(0, 160)}`); }
  console.log(`  pushed ${pushed} events. Aggregation is ASYNC — run 'enable' shortly (may need minutes/retries).`);
}

async function enable() {
  const cur = await call(SEARCH, 'GET', `/1/indexes/${INDEX}/settings`);
  if (cur.json.mode === 'neuralSearch') { console.log(`✅ ${INDEX}: already neuralSearch`); return true; }
  const put = await call(SEARCH, 'PUT', `/1/indexes/${INDEX}/settings`, { mode: 'neuralSearch' });
  if (put.status === 200) {
    if (put.json.taskID) for (let i = 0; i < 30; i++) { const t = await call(SEARCH, 'GET', `/1/indexes/${INDEX}/task/${put.json.taskID}`); if (t.json.status === 'published') break; await new Promise((r) => setTimeout(r, 1000)); }
    const g = await call(SEARCH, 'GET', `/1/indexes/${INDEX}/settings`);
    console.log(g.json.mode === 'neuralSearch' ? `✅ ${INDEX}: neuralSearch ENABLED` : `⚠ PUT 200 but mode=${g.json.mode}`);
    return g.json.mode === 'neuralSearch';
  }
  if (put.status === 412) { console.log(`⏳ ${INDEX}: still aggregating (412 "${put.json.message}") — re-run 'enable' later, or use the dashboard Train NeuralSearch flow (event source=${INDEX}, title attr, Blended, More Recall).`); return false; }
  console.log(`❌ HTTP ${put.status} ${JSON.stringify(put.json).slice(0, 200)}`); return false;
}

const cmd = process.argv[2];
if (cmd === 'seed') await seed();
else if (cmd === 'enable') process.exit((await enable()) ? 0 : 2);
else { await seed(); console.log('\n— attempting enable (likely still aggregating) —'); await enable(); }
