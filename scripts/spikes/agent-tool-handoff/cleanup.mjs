// Deletes every SPIKE-* agent and re-dumps ACS-generic-neural to diff against
// the Task 1 baseline, proving the spike left production agents untouched.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '..', '.env.local')]
  .filter(Boolean)
  .find((p) => existsSync(p));
const ENV = {};
for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV.ALGOLIA_APP_ID, KEY = ENV.ALGOLIA_ADMIN_API_KEY;
const BASE = `https://${APP}.algolia.net/agent-studio/1`;
const H = { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' };

const r = await fetch(`${BASE}/agents?limit=100`, { headers: H });
const j = await r.json();
const all = j.data ?? j.agents ?? j.items ?? [];
const spikes = all.filter((a) => (a.name ?? '').startsWith('SPIKE-'));
for (const a of spikes) {
  const id = a.id ?? a.objectID;
  const d = await fetch(`${BASE}/agents/${id}`, { method: 'DELETE', headers: H });
  console.log(`DELETE ${a.name} (${id}) -> ${d.status}`);
}

const baseline = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', 'baseline-ACS-generic-neural.json'), 'utf8'));
const now = await (await fetch(`${BASE}/agents/13809d4b-6b6d-4297-b95c-a934bceef0b4`, { headers: H })).json();
const same = JSON.stringify(baseline.tools) === JSON.stringify(now.tools) && baseline.instructions === now.instructions;
console.log(`ACS-generic-neural tools+instructions unchanged since baseline: ${same}`);
if (!same) console.error('WARNING: production agent drifted during the spike — investigate before trusting the verdict.');
