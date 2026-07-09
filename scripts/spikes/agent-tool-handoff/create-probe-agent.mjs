// Attempts to create a disposable agent using the candidate client-tool schema
// from Task 2. A 2xx means Agent Studio ACCEPTS the shape (schema-validation
// level capability, still needs roundtrip-harness.mjs to confirm runtime
// pause behavior). A 4xx means it's rejected — that's the NO-GO signal.
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

const candidateTool = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', 'candidate-tool-schema.json'), 'utf8'));
// Live API rejected the docs' conceptual {type:"function", function:{...}} shape
// (422: valid discriminators are client_side/algolia_search_index/algolia_recommend/
// algolia_display_results/mcp_tools/unknown). Task 1's baseline dump shows real tool
// objects are FLAT ({name, type, ...type-specific fields} — no nested wrapper keyed
// by the type name), so trying the same flattening for client_side.
const { function: fn } = candidateTool;
// Live API (422 validation errors, ground truth over docs): tool fields nest
// under a key named after `type`, and use `inputSchema` not `parameters`;
// `description` is capped at 200 chars.
// Probe several candidate shapes in sequence — the earlier flat/nested-object
// attempts both got "Field required" for description+inputSchema even though
// present, which smells like a type mismatch (e.g. inputSchema expected as a
// JSON string, not an object) rather than a location problem.
const candidates = [
  {
    label: 'nested client_side, inputSchema as JSON string',
    payload: {
      name: fn.name,
      type: 'client_side',
      client_side: {
        description: 'Hand the user question verbatim to the Technical specialist agent for deep React Spectrum code answers.',
        inputSchema: JSON.stringify(fn.parameters),
      },
    },
  },
  {
    label: 'nested client_side, parameters (not inputSchema) as object',
    payload: {
      name: fn.name,
      type: 'client_side',
      client_side: {
        description: 'Hand the user question verbatim to the Technical specialist agent for deep React Spectrum code answers.',
        parameters: fn.parameters,
      },
    },
  },
  {
    label: 'flat top-level description+inputSchema (no nested client_side object at all)',
    payload: {
      name: fn.name,
      type: 'client_side',
      description: 'Hand the user question verbatim to the Technical specialist agent for deep React Spectrum code answers.',
      inputSchema: fn.parameters,
    },
  },
];
const baseId = '13809d4b-6b6d-4297-b95c-a934bceef0b4'; // ACS-generic-neural (read-only GET, never modified)
const base = await (await fetch(`${BASE}/agents/${baseId}`, { headers: H })).json();

for (const { label, payload } of candidates) {
  const body = {
    name: 'SPIKE-tool-probe',
    instructions: 'You are a test agent for React Spectrum questions. For ANY user question, you MUST call the `consult_technical_specialist` tool with the user question verbatim as the `query` argument. Do not answer directly — always call the tool first. After receiving the tool result, relay it verbatim to the user.',
    model: base.model,
    providerId: base.providerId ?? base.provider_id,
    tools: [payload],
    status: 'published',
  };
  const r = await fetch(`${BASE}/agents`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  console.log(`\n=== candidate: ${label} ===`);
  console.log(`POST /agents -> ${r.status}`);
  console.log(text.slice(0, 1200));
  if (r.status === 200 || r.status === 201) {
    console.log('\n*** ACCEPTED — stopping probe loop, this is the working shape ***');
    break;
  }
}
