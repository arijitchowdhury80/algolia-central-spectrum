/**
 * build_acs_agents — the ACS agent panel (Generic / Technical / Classifier) over ACS_SPECTRUM_MULTI.
 * Scoping = native searchParameters.filters on `source` (the proven mechanism).
 * Clone-base for tool scaffold/model/provider = CLONE_BASE (self-hosting,
 * falls back to any already-published *-neural agent on this app if the
 * panel hasn't been built yet).
 *
 *   node build_acs_agents.mjs           # create/refresh, print ids
 *   node build_acs_agents.mjs --delete
 *   node build_acs_agents.mjs --list
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PERSONAS, INDEX, CLONE_BASE, RETIRE, MAIN_MODEL, buildAgentName, buildSuggestionsConfig, buildAgentBody, assertSuggestionsEnabled, scopeTools } from './agentConfig.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean).find((p) => existsSync(p));
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const APP = ENV.ALGOLIA_APP_ID, KEY = ENV.ALGOLIA_ADMIN_API_KEY;
const BASE = `https://${APP}.algolia.net/agent-studio/1`;
const H = { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' };
async function call(method, path, body) { const r = await fetch(`${BASE}${path}`, { method, headers: H, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 400) }; } return { status: r.status, json: j }; }
async function listAgents() { const r = await call('GET', '/agents?limit=100'); const arr = r.json.data ?? r.json.agents ?? r.json.items ?? []; const m = {}; for (const a of arr) { const id = a.id ?? a.objectID; if (a.name && id) m[a.name] = id; } return m; }

// Dry-run mechanism: prefix every live-agent name lookup/create/patch with
// this suffix so a test run never touches the production agents. Empty →
// backward-compatible default (the real live names).
const SUFFIX = process.env.ACS_AGENT_SUFFIX ?? '';

function loadPrompt(file) { let s = readFileSync(join(__dirname, file), 'utf8'); if (s.includes('[[SHARED_GROUNDING]]')) s = s.replace('[[SHARED_GROUNDING]]', readFileSync(join(__dirname, '_shared_grounding_acs.md'), 'utf8').trim()); return s; }

const mode = process.argv[2];
const existing = await listAgents();
const names = PERSONAS.map((p) => buildAgentName(p.name, SUFFIX));
if (mode === '--list') { for (const n of names) console.log(`  ${n} → ${existing[n] ?? '(none)'}`); process.exit(0); }
if (mode === '--delete') { for (const n of names) { const id = existing[n]; if (!id) { console.log(`  ${n} — absent`); continue; } const d = await call('DELETE', `/agents/${id}`); console.log(`  DELETE ${n} → HTTP ${d.status}`); } process.exit(0); }

// retire superseded agents first
for (const n of RETIRE) { if (existing[n]) { const d = await call('DELETE', `/agents/${existing[n]}`); console.log(`  RETIRE ${n} → HTTP ${d.status}`); } }

// clone tool scaffold/model/provider from an existing published agent (self, else any *-neural agent on this app)
const baseId = existing[CLONE_BASE] ?? Object.entries(existing).find(([n]) => /neural$/.test(n))?.[1];
if (!baseId) { console.error('no clone-base agent found'); process.exit(1); }
const base = (await call('GET', `/agents/${baseId}`)).json;

// Native suggestions system_prompt per persona (B1). Keyed by bare persona
// name so it survives any ACS_AGENT_SUFFIX dry-run rename.
const SUGGESTIONS_PROMPT = {
  'ACS-generic-neural': loadPrompt('suggestions_generic.md'),
  'ACS-technical-neural': loadPrompt('suggestions_technical.md'),
};

for (const { name, prompt, filters, desc, extraTools, noSearchTool, expectSuggestions } of PERSONAS) {
  const agentName = buildAgentName(name, SUFFIX);
  const instructions = loadPrompt(prompt);
  const tools = [...scopeTools(base.tools, filters, desc, { noSearchTool }), ...extraTools];
  const providerId = base.providerId ?? base.provider_id;
  const wantSuggestions = expectSuggestions ?? true;
  const suggestionsConfig = buildSuggestionsConfig(SUGGESTIONS_PROMPT[name] ?? '', wantSuggestions);
  const existingId = existing[agentName];
  let id;
  if (existingId) {
    // PATCH in place — confirmed live 2026-07-09 (HTTP 200, ID unchanged,
    // status stays "published"). Never delete+recreate a live agent: this
    // project's frontend (and production's deployed bundle) hardcode agent
    // IDs, so a churned ID silently 404s anyone still pointing at the old
    // one. See docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md for the
    // incident this replaced.
    const body = buildAgentBody({ instructions, model: MAIN_MODEL, providerId, tools, suggestionsConfig });
    const p = await call('PATCH', `/agents/${existingId}`, body);
    if (p.status !== 200) { console.error(`patch ${agentName} → ${p.status}: ${JSON.stringify(p.json).slice(0, 400)}`); process.exit(1); }
    id = existingId;
  } else {
    const body = buildAgentBody({ name: agentName, status: 'published', instructions, model: MAIN_MODEL, providerId, tools, suggestionsConfig });
    const c = await call('POST', '/agents', body);
    if (![200, 201].includes(c.status)) { console.error(`create ${agentName} → ${c.status}: ${JSON.stringify(c.json).slice(0, 400)}`); process.exit(1); }
    id = c.json.id ?? c.json.objectID;
    await call('POST', `/agents/${id}/publish`, {});
  }
  const v = await call('GET', `/agents/${id}`);
  const enabledOk = assertSuggestionsEnabled(v.json);
  console.log(`  ${agentName} → ${id}${existingId ? ' (patched in place, ID unchanged)' : ' (created)'}`);
  console.log(`      index=${v.json.tools?.[0]?.indices?.[0]?.index}  filter=${v.json.tools?.[0]?.indices?.[0]?.searchParameters?.filters}  tools=${v.json.tools?.map((t) => t.type).join('+')}  prompt=${instructions.length}ch  model=${v.json.model}  suggestions=${enabledOk ? 'on' : 'off'} (expected ${wantSuggestions ? 'on' : 'off'})`);
  // Two-sided hard gate (Task A1): a persona is not "done" unless the server's
  // reported suggestions.enabled state matches what THIS persona expects —
  // either direction wrong is a real failure, not just the "expected on but
  // missing" case the prior single-sided gate caught.
  if (wantSuggestions && !enabledOk) { console.error(`  ${agentName}: config.suggestions did not round-trip enabled — hard gate failed.`); process.exit(1); }
  if (!wantSuggestions && enabledOk) { console.error(`  ${agentName}: expected suggestions OFF but server reports ON — hard gate failed (would silently reintroduce the caching-race signal path this track exists to remove).`); process.exit(1); }
}
console.log('[build_acs_agents] done.');
