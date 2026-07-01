/**
 * build_acs_agents — the ACS 2-persona panel (Designer / Developer) over ACS_SPECTRUM_MULTI.
 * Ported from AC2 scripts/setup/honed/build_three_agents.mjs. Scoping = native
 * searchParameters.filters on `source` (the proven mechanism). Clone-base for tool
 * scaffold/model/provider = ac2-developer-neural (an existing published agent).
 *
 *   node build_acs_agents.mjs           # create/refresh, print ids
 *   node build_acs_agents.mjs --delete
 *   node build_acs_agents.mjs --list
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean).find((p) => existsSync(p));
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const APP = ENV.ALGOLIA_APP_ID, KEY = ENV.ALGOLIA_ADMIN_API_KEY;
const BASE = `https://${APP}.algolia.net/agent-studio/1`;
const H = { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' };
async function call(method, path, body) { const r = await fetch(`${BASE}${path}`, { method, headers: H, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 400) }; } return { status: r.status, json: j }; }
async function listAgents() { const r = await call('GET', '/agents?limit=100'); const arr = r.json.data ?? r.json.agents ?? r.json.items ?? []; const m = {}; for (const a of arr) { const id = a.id ?? a.objectID; if (a.name && id) m[a.name] = id; } return m; }

const INDEX = 'ACS_SPECTRUM_MULTI';
const CLONE_BASE = 'ac2-developer-neural';
const PERSONAS = [
  { name: 'ACS-designer-neural', prompt: 'instructions_designer.md', filters: 'source:"SpectrumDesignDocs"', desc: 'ACS_SPECTRUM_MULTI scoped to Spectrum design docs (SpectrumDesignDocs).' },
  { name: 'ACS-developer-neural', prompt: 'instructions_developer.md', filters: 'source:"ReactSpectrumS2" OR source:"ReactAria"', desc: 'ACS_SPECTRUM_MULTI scoped to React code docs (ReactSpectrumS2 + ReactAria/internationalized).' },
];

function loadPrompt(file) { let s = readFileSync(join(__dirname, file), 'utf8'); if (s.includes('[[SHARED_GROUNDING]]')) s = s.replace('[[SHARED_GROUNDING]]', readFileSync(join(__dirname, '_shared_grounding_acs.md'), 'utf8').trim()); return s; }
function scopeTools(tools, filters, desc) { const t = JSON.parse(JSON.stringify(tools)); for (const tool of t) { tool.description = desc; if (Array.isArray(tool.indices)) for (const ix of tool.indices) { ix.index = INDEX; ix.description = desc; ix.searchParameters = ix.searchParameters ?? {}; ix.searchParameters.filters = filters; } } return t; }

const mode = process.argv[2];
const existing = await listAgents();
const names = PERSONAS.map((p) => p.name);
if (mode === '--list') { for (const n of names) console.log(`  ${n} → ${existing[n] ?? '(none)'}`); process.exit(0); }
if (mode === '--delete') { for (const n of names) { const id = existing[n]; if (!id) { console.log(`  ${n} — absent`); continue; } const d = await call('DELETE', `/agents/${id}`); console.log(`  DELETE ${n} → HTTP ${d.status}`); } process.exit(0); }

const baseId = existing[CLONE_BASE];
if (!baseId) { console.error(`clone-base ${CLONE_BASE} not found`); process.exit(1); }
const base = (await call('GET', `/agents/${baseId}`)).json;
for (const { name, prompt, filters, desc } of PERSONAS) {
  const instructions = loadPrompt(prompt);
  const tools = scopeTools(base.tools, filters, desc);
  const body = { name, instructions, model: base.model, providerId: base.providerId ?? base.provider_id, tools, status: 'published' };
  if (existing[name]) await call('DELETE', `/agents/${existing[name]}`);
  const c = await call('POST', '/agents', body);
  if (![200, 201].includes(c.status)) { console.error(`create ${name} → ${c.status}: ${JSON.stringify(c.json).slice(0, 400)}`); process.exit(1); }
  const id = c.json.id ?? c.json.objectID;
  await call('POST', `/agents/${id}/publish`, {});
  const v = await call('GET', `/agents/${id}`);
  console.log(`  ${name} → ${id}`);
  console.log(`      index=${v.json.tools?.[0]?.indices?.[0]?.index}  filter=${v.json.tools?.[0]?.indices?.[0]?.searchParameters?.filters}  prompt=${instructions.length}ch  model=${body.model}`);
}
console.log('[build_acs_agents] done.');
