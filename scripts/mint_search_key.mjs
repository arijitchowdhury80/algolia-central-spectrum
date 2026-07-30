// Mint a browser-shippable SEARCH-ONLY Algolia key scoped to ACS_SPECTRUM_MULTI.
// Reads admin key from .env.local (never hardcode). Prints the new key + a .env line to paste into web/.
// Usage: node scripts/mint_search_key.mjs [--index ACS_SPECTRUM_MULTI]
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const A = {};
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); A[k] = (i + 1 < a.length && !a[i + 1].startsWith('--')) ? a[++i] : true; } }
const INDEX = A.index || 'ACS_SPECTRUM_MULTI';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [A.env, join(process.cwd(), '.env.local'), join(__dirname, '..', '.env.local')].filter(Boolean).find((p) => existsSync(p));
if (!envPath) { console.error('no .env.local found'); process.exit(1); }
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
// Prefer the master Admin key (key-management ACL); the plain admin key is a scoped write key that can't mint keys.
const APP = ENV.ALGOLIA_APP_ID, AKEY = ENV.ALGOLIA_MASTER_ADMIN_KEY || ENV.ALGOLIA_ADMIN_API_KEY;
if (!APP || !AKEY) { console.error('missing ALGOLIA_APP_ID + (ALGOLIA_MASTER_ADMIN_KEY | ALGOLIA_ADMIN_API_KEY)'); process.exit(1); }

async function aApi(method, path, body) {
  const r = await fetch(`https://${APP}.algolia.net${path}`, { method, headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': AKEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

const body = {
  acl: ['search'],                          // search only — cannot write, cannot read settings/keys
  indexes: [INDEX],                         // scoped to the one index; no other index reachable
  description: `ACS UI browser search-only key — Agent Studio completions + source enrichment, ${INDEX} only (${new Date().toISOString().slice(0,10)})`,
};

const res = await aApi('POST', '/1/keys', body);
if (res.status !== 200 && res.status !== 201) { console.error('mint FAILED', res.status, JSON.stringify(res.json)); process.exit(1); }
const key = res.json.key;
console.log('✅ minted search-only key:', key);
console.log('   acl=search · indexes=[' + INDEX + '] · app=' + APP);
console.log('\nPaste into web/.env.local:');
console.log('VITE_ALGOLIA_APP_ID=' + APP);
console.log('VITE_ALGOLIA_SEARCH_API_KEY=' + key);
