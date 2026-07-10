// E2E architecture validation for the pure-orchestrator design (Arijit, 2026-07-09),
// run per the 2026-07-10 test-plan agreed with Arijit before any Build task starts.
//
// Unlike probe-orchestrator.mjs (tonight's earlier spike), this script feeds the
// orchestrator REAL generalist output — real answer text, real config.suggestions
// frame, real SPECIALIST: signal — never a hand-written fake result. That's the
// exact gap VERDICT.md flagged as unproven: "nothing proves Generalist can actually
// produce this flag in Agent Studio's real response format."
//
// Tests, mapped to the agreed test-plan:
//   T1 — generalist-dev answers with full text (no tools registered) — baseline check
//   T2/T5 — real SPECIALIST offer precision across 5 design + 5 implementation questions
//   T3 — orchestrator-dev chains to call_specialist iff the REAL offer signal is true
//   T4 — specialist-dev produces a real grounded answer when actually invoked
// T6 (browser, network tab) is explicitly OUT of this script's scope — flagged at the end.
//
// Agents touched: ACS-generic-neural-dev, ACS-technical-neural-dev (existing, read-only
// via completions — never PATCHed here), plus a disposable SPIKE-orchestrator-e2e agent
// created and deleted by this script. No production ACS-* agent is read or written.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
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
const APP = ENV.ALGOLIA_APP_ID, ADMIN_KEY = ENV.ALGOLIA_ADMIN_API_KEY, SEARCH_KEY = ENV.ALGOLIA_SEARCH_API_KEY;
const BASE = `https://${APP}.algolia.net/agent-studio/1`;
const H_ADMIN = { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': ADMIN_KEY, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' };
const H_SEARCH = { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': SEARCH_KEY };

const GENERIC_DEV_ID = '7c4d1476-d6b0-4002-bb04-6697a6284695';
const TECHNICAL_DEV_ID = 'b4751d09-41d8-467e-bde3-eaa483fa5974';
const ORCH_NAME = 'SPIKE-orchestrator-e2e';

const QUESTIONS = [
  { type: 'design', q: "When should someone pick Spectrum's Tabs component over an Accordion for organizing content?" },
  { type: 'design', q: "What's the philosophy behind Spectrum's color system for light and dark themes?" },
  { type: 'design', q: "How does Spectrum's spacing scale guide layout density decisions?" },
  { type: 'design', q: 'Why does Spectrum recommend against custom icon sets in enterprise apps?' },
  { type: 'design', q: "What's the design rationale for Spectrum's motion and animation guidelines?" },
  { type: 'impl', q: 'How do I implement a controlled Checkbox with an indeterminate state in React Spectrum S2?' },
  { type: 'impl', q: 'What TypeScript props do I need to wire up async loading in a Picker component in React Spectrum?' },
  { type: 'impl', q: 'How do I set up form validation errors on a TextArea in React Aria?' },
  { type: 'impl', q: "What's the code for handling onSelectionChange in a ListView with multiple selection in React Spectrum?" },
  { type: 'impl', q: 'How do I write a drag-and-drop reorder handler for a GridList in React Aria?' },
];

async function readStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

function frames(text, prefix) {
  return text.split('\n').filter((l) => l.startsWith(prefix));
}
function textFrom(text) {
  return frames(text, '0:').map((l) => { try { return JSON.parse(l.slice(2)); } catch { return ''; } }).join('');
}
function toolCallFrom(text) {
  const tcs = frames(text, '9:').map((l) => { try { return JSON.parse(l.slice(2)); } catch { return null; } }).filter(Boolean);
  return tcs[0] ?? null;
}
// Real suggestions frame shape, confirmed live 2026-07-09: prefix '2', payload
// [{"suggestions": ["..."]}]. SPECIALIST: is literal text at the start of a string.
function suggestionsFrom(text) {
  const out = [];
  for (const l of frames(text, '2:')) {
    try {
      const parsed = JSON.parse(l.slice(2));
      for (const item of parsed) if (Array.isArray(item?.suggestions)) out.push(...item.suggestions);
    } catch { /* skip malformed frame, same discipline as production parser */ }
  }
  return out;
}
function extractOffer(suggestions) {
  const i = suggestions.findIndex((s) => s.startsWith('SPECIALIST:'));
  if (i === -1) return { offer: undefined, rest: suggestions };
  const rest = suggestions.slice(0, i).concat(suggestions.slice(i + 1));
  return { offer: suggestions[i].slice('SPECIALIST:'.length).trim(), rest };
}

async function callDirectAgent(agentId, query) {
  const url = `${BASE}/agents/${agentId}/completions?compatibilityMode=ai-sdk-4`;
  const res = await fetch(url, { method: 'POST', headers: H_SEARCH, body: JSON.stringify({ messages: [{ role: 'user', content: query }] }) });
  const raw = await readStream(res);
  const text = textFrom(raw);
  const suggestions = suggestionsFrom(raw);
  return { httpStatus: res.status, text, suggestions, raw };
}

async function cleanupOrchestrator() {
  const r = await fetch(`${BASE}/agents?limit=100`, { headers: H_ADMIN });
  const j = await r.json();
  const all = j.data ?? j.agents ?? j.items ?? [];
  for (const a of all.filter((a) => a.name === ORCH_NAME)) {
    const d = await fetch(`${BASE}/agents/${a.id}`, { method: 'DELETE', headers: H_ADMIN });
    console.log(`cleanup: DELETE ${a.name} (${a.id}) -> ${d.status}`);
  }
}

async function createOrchestrator() {
  const tools = [
    { name: 'call_generalist', type: 'client_side', description: "Get the generalist agent's answer to the user question.", inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'call_specialist', type: 'client_side', description: "Get the technical specialist agent's deep-dive answer to the user question.", inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  ];
  const instructions = [
    'You are a silent router. You NEVER answer any question yourself, in any form, ever.',
    'On EVERY user turn you MUST respond by calling exactly one tool — never with plain text.',
    "Step 1: on the FIRST turn for a new question, always call `call_generalist` with the user question verbatim as `query`. Do not write any text before or after the tool call.",
    "Step 2: after you receive the call_generalist result, inspect its `offerSpecialist` field.",
    '  - If `offerSpecialist` is true, call `call_specialist` with the same query, again with zero text before or after.',
    '  - If `offerSpecialist` is false or absent, end your turn immediately with NO text output at all.',
    'Step 3: after receiving the call_specialist result (if you called it), end your turn immediately with NO text output at all.',
  ].join('\n');
  const createBody = { name: ORCH_NAME, instructions, model: 'gemini-2.5-flash', providerId: 'a1ca01bf-bc28-4844-89d1-331b79c3e1ab', tools, status: 'published' };
  const createRes = await fetch(`${BASE}/agents`, { method: 'POST', headers: H_ADMIN, body: JSON.stringify(createBody) });
  const created = await createRes.json();
  if (!created.id) throw new Error(`orchestrator create failed: ${JSON.stringify(created)}`);
  const pubRes = await fetch(`${BASE}/agents/${created.id}/publish`, { method: 'POST', headers: H_ADMIN });
  console.log(`orchestrator create -> ${createRes.status}, publish -> ${pubRes.status}, id=${created.id}`);
  return created.id;
}

async function runOrchestratorTurn(orchId, query) {
  const url = `${BASE}/agents/${orchId}/completions?compatibilityMode=ai-sdk-4`;
  const r1 = await fetch(url, { method: 'POST', headers: H_SEARCH, body: JSON.stringify({ messages: [{ role: 'user', content: query }] }) });
  const t1 = await readStream(r1);
  const tc1 = toolCallFrom(t1);
  return { text1: textFrom(t1), tc1 };
}

async function resumeOrchestratorWithRealGeneralistResult(orchId, query, tc1, realResult) {
  const url = `${BASE}/agents/${orchId}/completions?compatibilityMode=ai-sdk-4`;
  const body = {
    messages: [
      { id: 'msg_1', role: 'user', content: query, parts: [{ type: 'text', text: query }] },
      { id: 'msg_2', role: 'assistant', content: '', parts: [{ type: 'tool-invocation', toolInvocation: { state: 'result', toolCallId: tc1.toolCallId ?? tc1.id, toolName: 'call_generalist', args: { query }, result: realResult } }] },
    ],
  };
  const r2 = await fetch(url, { method: 'POST', headers: H_SEARCH, body: JSON.stringify(body) });
  const t2 = await readStream(r2);
  return { text2: textFrom(t2), tc2: toolCallFrom(t2) };
}

async function main() {
  const results = [];
  let t1BaselinePass = true;

  console.log('=== T1: generalist-dev answers with full text (no tool registered) — baseline ===');
  const baseline = await callDirectAgent(GENERIC_DEV_ID, 'How do I implement a controlled Checkbox with an indeterminate state in React Spectrum S2?');
  console.log(`HTTP ${baseline.httpStatus}, text length ${baseline.text.length}`);
  t1BaselinePass = baseline.httpStatus === 200 && baseline.text.length > 0;
  console.log(`T1 VERDICT: ${t1BaselinePass ? 'PASS' : 'FAIL'} — ${t1BaselinePass ? 'full text produced' : 'no text emitted, baseline broken'}\n`);

  console.log('=== T5 (+T2 signal source): real SPECIALIST offer precision, 5 design + 5 impl ===');
  for (const { type, q } of QUESTIONS) {
    const call = await callDirectAgent(GENERIC_DEV_ID, q);
    const { offer } = extractOffer(call.suggestions);
    const expectOffer = type === 'impl';
    const gotOffer = !!offer;
    const precisionPass = gotOffer === expectOffer;
    console.log(`[${type}] "${q.slice(0, 60)}..." -> offer=${gotOffer ? `YES ("${offer.slice(0, 60)}...")` : 'no'} | expected=${expectOffer} | ${precisionPass ? 'PASS' : 'FAIL'}`);
    results.push({ type, q, realAnswerText: call.text, offer, expectOffer, gotOffer, precisionPass });
  }
  const precisionPassCount = results.filter((r) => r.precisionPass).length;
  console.log(`T5 VERDICT: ${precisionPassCount}/10 correct\n`);

  console.log('=== T3/T4: orchestrator chaining fed REAL generalist output (not faked) ===');
  await cleanupOrchestrator();
  const orchId = await createOrchestrator();
  for (const r of results) {
    const turn1 = await runOrchestratorTurn(orchId, r.q);
    if (!turn1.tc1 || turn1.tc1.toolName !== 'call_generalist') {
      console.log(`[${r.type}] ORCH ROUND1 FAIL — expected call_generalist, got: ${turn1.tc1 ? turn1.tc1.toolName : 'none, text=' + turn1.text1.slice(0, 80)}`);
      r.orchRound1Pass = false;
      r.orchChainPass = false;
      continue;
    }
    r.orchRound1Pass = true;
    // Real result: r.realAnswerText and r.gotOffer both come from T5's real call above — no fabrication.
    const realResult = { answer: r.realAnswerText, offerSpecialist: r.gotOffer };
    const turn2 = await resumeOrchestratorWithRealGeneralistResult(orchId, r.q, turn1.tc1, realResult);
    const chainedToSpecialist = !!(turn2.tc2 && turn2.tc2.toolName === 'call_specialist');
    const chainPass = chainedToSpecialist === r.gotOffer;
    r.orchChainPass = chainPass;
    console.log(`[${r.type}] realOffer=${r.gotOffer} -> orchestrator chained=${!!chainedToSpecialist} | ${chainPass ? 'PASS' : 'FAIL'}`);

    if (chainedToSpecialist) {
      const specialistCall = await callDirectAgent(TECHNICAL_DEV_ID, r.q);
      r.specialistAnswered = specialistCall.httpStatus === 200 && specialistCall.text.length > 0;
      console.log(`    T4: specialist-dev real call -> HTTP ${specialistCall.httpStatus}, text length ${specialistCall.text.length} | ${r.specialistAnswered ? 'PASS' : 'FAIL'}`);
    }
  }
  await cleanupOrchestrator();

  const chainPassCount = results.filter((r) => r.orchChainPass).length;
  const specialistCalls = results.filter((r) => r.gotOffer);
  const specialistPassCount = specialistCalls.filter((r) => r.specialistAnswered).length;

  console.log('\n=== OVERALL ===');
  console.log(`T1 (baseline full text):            ${t1BaselinePass ? 'PASS' : 'FAIL'}`);
  console.log(`T5 (real offer precision, 10 Qs):   ${precisionPassCount}/10`);
  console.log(`T3 (orchestrator chains on REAL sig): ${chainPassCount}/10`);
  console.log(`T4 (specialist real answer, ${specialistCalls.length} triggered): ${specialistPassCount}/${specialistCalls.length}`);
  console.log('T6 (real browser/network-tab check): NOT RUN — out of this script\'s scope, requires manual browser pass.');

  writeFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', '2026-07-10-e2e-orchestrator-results.json'), JSON.stringify(results, null, 2));

  const overallPass = t1BaselinePass && precisionPassCount === 10 && chainPassCount === 10 && specialistPassCount === specialistCalls.length;
  process.exit(overallPass ? 0 : 1);
}

main().catch(async (e) => { console.error('FATAL', e); await cleanupOrchestrator(); process.exit(1); });
