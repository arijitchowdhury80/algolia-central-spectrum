#!/usr/bin/env node
/**
 * setup_provider_inference — register the Algolia enablers INFERENCE SERVER as an
 * OpenAI-compatible provider in Agent Studio on this app, so the ACS agents can run
 * on it. Ported from AC2's setup_providers.mjs (same wire contract).
 *
 * Wire contract (Read receipt — AC2 setup_providers.mjs + live probe 2026-07-27):
 *   POST /agent-studio/1/providers
 *     {name, providerName:'openai_compatible', input:{apiKey, baseUrl, defaultModel}} → {id}
 *   Agent Studio VALIDATES on create (test call to baseUrl). Idempotent by name via GET.
 *   IMPORTANT: providerName MUST be 'openai_compatible', NOT 'openai'. The 'openai' type
 *   enforces a host allowlist (only api.openai.com etc.) and 422s a custom endpoint with
 *   "base_url does not appear to be a valid OpenAI endpoint". 'openai_compatible' skips
 *   that gate but REQUIRES input.defaultModel. (Valid providerName enum, from the API's own
 *   error: openai | azure_openai | google_genai | deepseek | openai_compatible | anthropic.)
 *
 * Auth: the inference server takes a Vault-minted OIDC JWT as the bearer (NOT a static
 * key). That JWT expires ~30 days out — when it lapses, re-mint
 *   vault read --field=token identity/oidc/token/enablers
 * put it in .env.local as ALGOLIA_INFERENCE_API_KEY, and re-run this with --rotate to
 * PATCH the stored provider key.
 *
 * Reads + appends ../../.env.local. Persists ALGOLIA_PROVIDER_INFERENCE_ID.
 *   --check  : print the recorded id + a 1-model health hint, no writes.
 *   --rotate : PATCH the existing provider's apiKey to the current ALGOLIA_INFERENCE_API_KEY.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ENV_PATH = join(ROOT, '.env.local');
const ENV = {};
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV['ALGOLIA_APP_ID'];
const ADMIN = ENV['ALGOLIA_ADMIN_API_KEY'];
const BASE_URL = ENV['ALGOLIA_INFERENCE_BASE_URL'];
const API_KEY = ENV['ALGOLIA_INFERENCE_API_KEY'];
const DEFAULT_MODEL = ENV['ALGOLIA_INFERENCE_MODEL'] || 'medium';
const PROVIDER_NAME = 'acs-inference';
const CHECK = process.argv.includes('--check');
const ROTATE = process.argv.includes('--rotate');
const mask = (k) => (k ? `…${String(k).slice(-6)}` : '(none)');

if (!APP || !ADMIN) { console.error('Missing ALGOLIA_APP_ID / ALGOLIA_ADMIN_API_KEY in .env.local'); process.exit(1); }
if (!BASE_URL || !API_KEY) { console.error('Missing ALGOLIA_INFERENCE_BASE_URL / ALGOLIA_INFERENCE_API_KEY in .env.local'); process.exit(1); }

async function call(method, path, body) {
  const res = await fetch(`https://${APP}.algolia.net${path}`, {
    method,
    headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': ADMIN, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json };
}
function persist(key, val) {
  const env = readFileSync(ENV_PATH, 'utf8');
  if (new RegExp(`^${key}=`, 'm').test(env)) { console.log(`     ${key} already in .env.local`); return; }
  appendFileSync(ENV_PATH, `\n${key}=${val}\n`);
  console.log(`     wrote ${key}=${val} to .env.local`);
}

const { json: provs } = await call('GET', '/agent-studio/1/providers');
const existing = (provs.data ?? []).find((p) => p.name === PROVIDER_NAME);

if (CHECK) {
  console.log(`provider ${PROVIDER_NAME} = ${existing ? existing.id : '(not registered)'}`);
  console.log(`recorded ALGOLIA_PROVIDER_INFERENCE_ID = ${ENV['ALGOLIA_PROVIDER_INFERENCE_ID'] ?? '(none)'}`);
  process.exit(0);
}

if (existing && ROTATE) {
  const { status, json } = await call('PATCH', `/agent-studio/1/providers/${existing.id}`, { input: { apiKey: API_KEY, baseUrl: BASE_URL, defaultModel: DEFAULT_MODEL } });
  if (![200, 201].includes(status)) { console.error(`  ❌ rotate ${PROVIDER_NAME} → HTTP ${status}: ${JSON.stringify(json).slice(0, 200)}`); process.exit(1); }
  console.log(`  rotated ${PROVIDER_NAME} → ${existing.id} (key ${mask(API_KEY)})`);
  process.exit(0);
}

if (existing) {
  console.log(`  reuse ${PROVIDER_NAME} → ${existing.id} (run with --rotate to refresh the key)`);
  persist('ALGOLIA_PROVIDER_INFERENCE_ID', existing.id);
  process.exit(0);
}

const { status, json } = await call('POST', '/agent-studio/1/providers', {
  name: PROVIDER_NAME, providerName: 'openai_compatible', input: { apiKey: API_KEY, baseUrl: BASE_URL, defaultModel: DEFAULT_MODEL },
});
if (![200, 201].includes(status)) { console.error(`  ❌ create ${PROVIDER_NAME} → HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`); process.exit(1); }
console.log(`  created ${PROVIDER_NAME} → ${json.id} (openai_compatible, baseUrl=${BASE_URL}, defaultModel=${DEFAULT_MODEL}, key ${mask(API_KEY)})`);
persist('ALGOLIA_PROVIDER_INFERENCE_ID', json.id);
