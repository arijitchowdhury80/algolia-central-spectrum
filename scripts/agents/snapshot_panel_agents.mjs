#!/usr/bin/env node
/**
 * snapshot_panel_agents — dump the LIVE config of the three panel agents.
 *
 * WHY THIS EXISTS
 * ---------------
 * A prior snapshot covered only the four JUDGE agents. The three agents the demo actually talks
 * to — generic, technical, classifier — have never been snapshotted, so until now "roll back the
 * agent" had no address.
 *
 * Read-only: GETs each agent and writes the full JSON. Run it BEFORE any instruction PATCH.
 *
 *   node scripts/agents/snapshot_panel_agents.mjs [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const envPath = [join(ROOT, '.env.local')].find((p) => existsSync(p));
if (!envPath) {
  console.error('snapshot_panel_agents: no .env.local found');
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

/** The three agents the live demo talks to. */
const AGENTS = {
  'ACS-generic-neural': '95826da6-d1b6-4b81-b061-bfb52b881356',
  'ACS-technical-neural': 'ae127977-c728-4b7c-bc15-6502a77873d1',
  'ACS-classifier-neural': 'dbb4faa9-e917-4be9-b8ee-6dfd9a81daef',
};

const outArg = process.argv.indexOf('--out');
const OUT = outArg !== -1
  ? process.argv[outArg + 1]
  : join(ROOT, 'scripts/agents/snapshots/agent-snapshots.json');

const snapshot = { capturedAt: new Date().toISOString(), app: APP, agents: {} };

for (const [name, id] of Object.entries(AGENTS)) {
  const res = await fetch(`${BASE}/agents/${id}`, { headers: H });
  const text = await res.text();
  if (!res.ok) {
    console.error(`  ${name} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    process.exit(1);
  }
  const json = JSON.parse(text);
  snapshot.agents[name] = json;
  console.log(
    `  ${name.padEnd(24)} model=${json.model ?? '?'} status=${json.status ?? '?'} ` +
      `instructions=${(json.instructions ?? '').length}ch`,
  );
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`\nwrote ${OUT.replace(`${ROOT}/`, '')}`);
console.log('Restore an agent with a PATCH of its saved { instructions, model, tools } fields.');
