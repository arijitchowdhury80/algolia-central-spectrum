/**
 * In-place change of an Agent Studio agent's MODEL (PATCH → publish), preserving
 * its ID + instructions + tools. Same proven pattern as update_generic_prompt.mjs
 * (AC2 agent_admin.mjs: Update Agent = PATCH partial body, publish is separate).
 *
 *   node update_agent_model.mjs --id <agentId> --model gemini-2.5-flash-lite
 *   node update_agent_model.mjs --model gemini-2.5-flash-lite      # defaults to ACS-generic-neural
 *
 * Read receipt: field name `model` from build_acs_agents.mjs:54 (create body);
 * PATCH+publish endpoints from update_generic_prompt.mjs:36-40.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const A = {};
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); A[k] = (i + 1 < a.length && !a[i + 1].startsWith('--')) ? a[++i] : true; } }
const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_ID = A.id || '95826da6-d1b6-4b81-b061-bfb52b881356'; // default ACS-generic-neural (rebuilt 2026-07-08)
const MODEL = A.model;
if (!MODEL || MODEL === true) { console.error('required: --model <modelId>  (e.g. gemini-2.5-flash-lite)'); process.exit(1); }

const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean).find((p) => existsSync(p));
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const APP = ENV.ALGOLIA_APP_ID, KEY = ENV.ALGOLIA_ADMIN_API_KEY;
if (!APP || !KEY) { console.error('missing ALGOLIA_APP_ID/ALGOLIA_ADMIN_API_KEY'); process.exit(1); }

async function call(method, path, body) {
  const r = await fetch(`https://${APP}.algolia.net${path}`, { method, headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t.slice(0, 400) }; } return { status: r.status, json: j };
}

const before = await call('GET', `/agent-studio/1/agents/${AGENT_ID}`);
console.log(`[update_model] agent=${before.json.name}  before.model=${JSON.stringify(before.json.model)}  → target=${MODEL}`);

const patch = await call('PATCH', `/agent-studio/1/agents/${AGENT_ID}`, { model: MODEL });
console.log(`  PATCH → HTTP ${patch.status}`);
if (patch.status !== 200) { console.log(JSON.stringify(patch.json).slice(0, 1000)); process.exit(1); }
const pub = await call('POST', `/agent-studio/1/agents/${AGENT_ID}/publish`, {});
console.log(`  PUBLISH → HTTP ${pub.status}`);
const chk = await call('GET', `/agent-studio/1/agents/${AGENT_ID}`);
console.log(`  CONFIRM → name=${chk.json.name}  status=${chk.json.status}  model=${JSON.stringify(chk.json.model)}`);
console.log(`  filter preserved = ${chk.json.tools?.[0]?.indices?.[0]?.searchParameters?.filters ?? '(none)'}`);
if (chk.json.model !== MODEL) { console.error('  ⚠ model did not stick — check provider supports this model id'); process.exit(1); }
console.log('  ✅ model updated + published');
