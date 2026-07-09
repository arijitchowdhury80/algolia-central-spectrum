/**
 * In-place update of the ACS Generic agent's instructions (PATCH → publish), preserving its ID.
 * Use this instead of build_acs_agents.mjs when only the prompt changes — the build script
 * DELETEs + recreates agents (new IDs), which would break the UI/SESSION wiring.
 *
 *   node update_generic_prompt.mjs
 *
 * Ported PATCH pattern from AC2 scripts/setup/agent_admin.mjs (Agent Studio Update Agent,
 * ACL editSettings; publish is a separate action).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_ID = '95826da6-d1b6-4b81-b061-bfb52b881356'; // ACS-generic-neural (source of truth: SESSION.md; rebuilt 2026-07-08 with the client_side tool-call architecture)

const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean).find((p) => existsSync(p));
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const APP = ENV.ALGOLIA_APP_ID, KEY = ENV.ALGOLIA_ADMIN_API_KEY;
if (!APP || !KEY) { console.error('missing ALGOLIA_APP_ID/ALGOLIA_ADMIN_API_KEY'); process.exit(1); }

async function call(method, path, body) {
  const r = await fetch(`https://${APP}.algolia.net${path}`, { method, headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t.slice(0, 400) }; } return { status: r.status, json: j };
}

// compose the prompt exactly like build_acs_agents.mjs (expand [[SHARED_GROUNDING]])
let instructions = readFileSync(join(__dirname, 'instructions_generic.md'), 'utf8');
if (instructions.includes('[[SHARED_GROUNDING]]')) instructions = instructions.replace('[[SHARED_GROUNDING]]', readFileSync(join(__dirname, '_shared_grounding_acs.md'), 'utf8').trim());

const hasSentinel = instructions.includes('[[HANDOFF:technical]]');
console.log(`[update_generic] agent=${AGENT_ID}  instructions=${instructions.length}ch  sentinel-instruction-present=${hasSentinel}`);
if (!hasSentinel) { console.error('refusing to publish: instructions_generic.md is missing the [[HANDOFF:technical]] sentinel instruction'); process.exit(1); }

const patch = await call('PATCH', `/agent-studio/1/agents/${AGENT_ID}`, { instructions });
console.log(`  PATCH → HTTP ${patch.status}`);
if (patch.status !== 200) { console.log(JSON.stringify(patch.json).slice(0, 1000)); process.exit(1); }
const pub = await call('POST', `/agent-studio/1/agents/${AGENT_ID}/publish`, {});
console.log(`  PUBLISH → HTTP ${pub.status}`);
const chk = await call('GET', `/agent-studio/1/agents/${AGENT_ID}`);
console.log(`  CONFIRM → name=${chk.json.name}  status=${chk.json.status}  instructions=${(chk.json.instructions ?? '').length}ch`);
console.log(`  filter preserved = ${chk.json.tools?.[0]?.indices?.[0]?.searchParameters?.filters ?? '(none — all sources, correct for Generic)'}`);
