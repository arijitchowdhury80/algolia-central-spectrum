#!/usr/bin/env node
/**
 * patch_agent_instructions — PATCH one live agent's instructions and nothing else.
 *
 * WHY NOT build_acs_agents.mjs
 * ---------------------------
 * That script rebuilds instructions AND tools AND filters AND the suggestions
 * config for all three agents. When the only change is user-facing wording in one
 * agent's prompt — hours before a demo — that is far more blast radius than the
 * change deserves. This sends exactly one field to exactly one agent.
 *
 * Snapshot first (`scripts/agents/snapshot_panel_agents.mjs`); restore by PATCHing
 * the `instructions` value back from that JSON.
 *
 *   node scripts/agents/patch_agent_instructions.mjs generic [--dry]
 *
 * Agents: generic | technical | classifier
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const envPath = join(ROOT, '.env.local');
if (!existsSync(envPath)) {
  console.error('patch_agent_instructions: no .env.local');
  process.exit(1);
}
const ENV = {};
for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV.ALGOLIA_APP_ID;
const KEY = ENV.ALGOLIA_ADMIN_API_KEY;
const BASE = `https://${APP}.algolia.net/agent-studio/1`;
const H = {
  'X-Algolia-Application-Id': APP,
  'X-Algolia-API-Key': KEY,
  'Content-Type': 'application/json',
  'User-Agent': 'curl/8.4.0',
};

const TARGETS = {
  generic: { id: '95826da6-d1b6-4b81-b061-bfb52b881356', file: 'instructions_generic.md' },
  technical: { id: 'ae127977-c728-4b7c-bc15-6502a77873d1', file: 'instructions_technical.md' },
  classifier: { id: 'dbb4faa9-e917-4be9-b8ee-6dfd9a81daef', file: 'instructions_classifier.md' },
};

const which = process.argv[2];
const dry = process.argv.includes('--dry');
const target = TARGETS[which];
if (!target) {
  console.error(`usage: patch_agent_instructions.mjs <${Object.keys(TARGETS).join('|')}> [--dry]`);
  process.exit(1);
}

/** Same shared-grounding expansion build_acs_agents.mjs performs. */
function loadPrompt(file) {
  let s = readFileSync(join(__dirname, file), 'utf8');
  if (s.includes('[[SHARED_GROUNDING]]')) {
    s = s.replace('[[SHARED_GROUNDING]]', readFileSync(join(__dirname, '_shared_grounding_acs.md'), 'utf8').trim());
  }
  return s;
}

const instructions = loadPrompt(target.file);

const before = await (await fetch(`${BASE}/agents/${target.id}`, { headers: H })).json();
console.log(`${which}: live instructions ${String(before.instructions ?? '').length}ch → new ${instructions.length}ch`);

// Guard: assert the rules are PRESENT rather than banning phrases.
//
// The first version of this guard banned substrings like "consult the Technical" —
// and immediately blocked its own fix, because the new prompt quotes that exact
// phrase as the example of what NOT to do. A substring cannot distinguish a rule
// from an illustration of the thing the rule forbids. Positive assertions can.
const REQUIRED = [
  { probe: 'raw.githubusercontent.com', why: 'the copy-never-construct URL rule' },
  { probe: 'corp.adobe.com', why: 'the internal-host prohibition' },
  { probe: 'Never name an internal component', why: 'the no-internal-names rule (shared block)' },
];
const missing = REQUIRED.filter((r) => !instructions.includes(r.probe));
if (missing.length) {
  console.error(`refusing to patch — prompt is missing ${missing.map((m) => m.why).join(', ')}`);
  process.exit(1);
}

if (dry) {
  console.log('--dry: not sending');
  process.exit(0);
}

const res = await fetch(`${BASE}/agents/${target.id}`, {
  method: 'PATCH',
  headers: H,
  body: JSON.stringify({ instructions }),
});
const text = await res.text();
console.log(`PATCH → HTTP ${res.status}`);
if (!res.ok) {
  console.error(text.slice(0, 400));
  process.exit(1);
}

const after = await (await fetch(`${BASE}/agents/${target.id}`, { headers: H })).json();
const applied = String(after.instructions ?? '') === instructions;
console.log(`verified: ${applied ? 'APPLIED' : 'MISMATCH — investigate before trusting'}`);
process.exit(applied ? 0 : 1);
