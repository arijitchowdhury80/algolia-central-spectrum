#!/usr/bin/env node
/**
 * restore_agent_from_snapshot — PATCH one live agent's instructions back from a
 * snapshot written by snapshot_panel_agents.mjs.
 *
 * WHY THIS IS NOT patch_agent_instructions.mjs
 * -------------------------------------------
 * That script reads the repo's instruction .md files and REFUSES to send a
 * prompt that lacks the shipped grounding fixes. Correct for forward patches,
 * and exactly wrong for a rollback: a pre-fix snapshot lacks those probes by
 * definition. Rolling back is therefore a separate, explicitly labelled tool —
 * it prints which fixes the snapshot is missing instead of blocking, so the
 * operator sees what they are giving up.
 *
 *   node scripts/agents/restore_agent_from_snapshot.mjs <snapshot.json> <generic|technical|classifier> [--dry]
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const envPath = join(ROOT, '.env.local');
if (!existsSync(envPath)) {
  console.error('restore_agent_from_snapshot: no .env.local');
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

const NAMES = {
  generic: 'ACS-generic-neural',
  technical: 'ACS-technical-neural',
  classifier: 'ACS-classifier-neural',
};

const [snapPath, which] = process.argv.slice(2);
const dry = process.argv.includes('--dry');
if (!snapPath || !NAMES[which]) {
  console.error(`usage: restore_agent_from_snapshot.mjs <snapshot.json> <${Object.keys(NAMES).join('|')}> [--dry]`);
  process.exit(1);
}

const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const saved = snap.agents?.[NAMES[which]];
if (!saved?.id || typeof saved.instructions !== 'string') {
  console.error(`snapshot has no usable ${NAMES[which]} entry`);
  process.exit(1);
}

const instructions = saved.instructions;
const before = await (await fetch(`${BASE}/agents/${saved.id}`, { headers: H })).json();
console.log(`${which} (${saved.id})`);
console.log(`  snapshot captured ${snap.capturedAt}`);
console.log(`  live ${String(before.instructions ?? '').length}ch -> snapshot ${instructions.length}ch`);

// Informational, NOT a gate. A rollback target legitimately predates fixes.
const FIXES = [
  { probe: 'raw.githubusercontent.com', why: 'copy-never-construct URL rule (fix #4)' },
  { probe: 'corp.adobe.com', why: 'internal-host prohibition (fix #4)' },
  { probe: 'Never name an internal component', why: 'no-internal-names rule (fix #5)' },
];
const missing = FIXES.filter((f) => !instructions.includes(f.probe));
if (missing.length) {
  console.log('  WARNING — this snapshot LACKS:');
  for (const m of missing) console.log(`    - ${m.why}`);
}

if (dry) {
  console.log('  --dry: not sending');
  process.exit(0);
}

const res = await fetch(`${BASE}/agents/${saved.id}`, {
  method: 'PATCH',
  headers: H,
  body: JSON.stringify({ instructions }),
});
console.log(`  PATCH -> HTTP ${res.status}`);
if (!res.ok) {
  console.error((await res.text()).slice(0, 400));
  process.exit(1);
}
const after = await (await fetch(`${BASE}/agents/${saved.id}`, { headers: H })).json();
const applied = String(after.instructions ?? '') === instructions;
console.log(`  verified: ${applied ? 'APPLIED' : 'MISMATCH — investigate before trusting'}`);
process.exit(applied ? 0 : 1);
