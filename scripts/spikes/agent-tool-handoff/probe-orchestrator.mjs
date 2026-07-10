// Tests the two unproven assumptions in the "pure orchestrator" design
// (Arijit, 2026-07-09): an agent with ZERO answering role, only 2 client_side
// tools (call_generalist, call_specialist), that must ALWAYS call a tool and
// NEVER answer in plain text, and that can chain a SECOND tool call after
// resuming from the FIRST tool's result — all in one conversation turn.
//
// Reuses the already-proven flat client_side tool shape (create-probe-agent.mjs)
// and the already-proven resume shape D (resume-with-result.mjs) — nothing new
// to reverse-engineer there. This script only tests NEW ground: forced
// zero-prose behavior, and 2-deep tool-call chaining.
//
// Usage: node probe-orchestrator.mjs
// Cleans itself up (deletes SPIKE-orchestrator-probe) on exit, success or fail.
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

const AGENT_NAME = 'SPIKE-orchestrator-probe';
const QUERY = 'What is the process for making a Slider controlled in React Spectrum?'; // unique wording — avoid the cache-poisoning bug class

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

async function cleanup() {
  const r = await fetch(`${BASE}/agents?limit=100`, { headers: H_ADMIN });
  const j = await r.json();
  const all = j.data ?? j.agents ?? j.items ?? [];
  const mine = all.filter((a) => a.name === AGENT_NAME);
  for (const a of mine) {
    const id = a.id ?? a.objectID;
    const d = await fetch(`${BASE}/agents/${id}`, { method: 'DELETE', headers: H_ADMIN });
    console.log(`cleanup: DELETE ${a.name} (${id}) -> ${d.status}`);
  }
}

async function main() {
  await cleanup(); // in case a prior failed run left one behind

  const tools = [
    {
      name: 'call_generalist',
      type: 'client_side',
      description: 'Get the generalist agent\'s answer to the user question.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
      name: 'call_specialist',
      type: 'client_side',
      description: 'Get the technical specialist agent\'s deep-dive answer to the user question.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  ];

  const instructions = [
    'You are a silent router. You NEVER answer any question yourself, in any form, ever.',
    'On EVERY user turn you MUST respond by calling exactly one tool — never with plain text.',
    'Step 1: on the FIRST turn for a new question, always call `call_generalist` with the user question verbatim as `query`. Do not write any text before or after the tool call.',
    'Step 2: after you receive the call_generalist result, inspect its `offerSpecialist` field.',
    '  - If `offerSpecialist` is true, call `call_specialist` with the same query, again with zero text before or after.',
    '  - If `offerSpecialist` is false or absent, end your turn immediately with NO text output at all — not even an acknowledgment.',
    'Step 3: after receiving the call_specialist result (if you called it), end your turn immediately with NO text output at all.',
    'Under no circumstances write prose. Your only valid outputs are: a call_generalist tool call, a call_specialist tool call, or nothing.',
  ].join('\n');

  const createBody = { name: AGENT_NAME, instructions, model: 'gemini-2.5-flash', providerId: 'a1ca01bf-bc28-4844-89d1-331b79c3e1ab', tools, status: 'published' };
  const createRes = await fetch(`${BASE}/agents`, { method: 'POST', headers: H_ADMIN, body: JSON.stringify(createBody) });
  const created = await createRes.json();
  console.log(`create -> ${createRes.status}`, created.id ? `id=${created.id}` : JSON.stringify(created).slice(0, 300));
  if (!created.id) { console.error('FATAL: agent creation failed, aborting'); await cleanup(); process.exit(1); }
  const agentId = created.id;

  // publish explicitly — status:"published" in the create body has been silently ignored before
  const pubRes = await fetch(`${BASE}/agents/${agentId}/publish`, { method: 'POST', headers: H_ADMIN });
  console.log(`publish -> ${pubRes.status}`);

  const url = `${BASE}/agents/${agentId}/completions?compatibilityMode=ai-sdk-4`;

  // --- Round 1: does it call call_generalist, with ZERO text? ---
  const r1 = await fetch(url, { method: 'POST', headers: H_SEARCH, body: JSON.stringify({ messages: [{ role: 'user', content: QUERY }] }) });
  const t1 = await readStream(r1);
  const text1 = textFrom(t1);
  const tc1 = toolCallFrom(t1);
  console.log('\n=== ROUND 1: initial question ===');
  console.log(`HTTP ${r1.status}`);
  console.log(`text emitted (should be EMPTY): "${text1}"`);
  console.log(`tool call: ${tc1 ? JSON.stringify(tc1).slice(0, 300) : 'NONE — FAIL, model answered in text or produced nothing'}`);
  const round1Pass = text1.length === 0 && tc1 && tc1.toolName === 'call_generalist';
  console.log(`ROUND 1 VERDICT: ${round1Pass ? 'PASS — forced tool-only behavior held' : 'FAIL'}`);
  if (!round1Pass) { writeFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', 'orchestrator-round1-fail.txt'), t1); await cleanup(); process.exit(1); }

  // --- Round 2: resume with a FAKE generalist result (offerSpecialist:true) — does it chain to call_specialist, with ZERO text? ---
  const fakeGeneralistResult = { answer: 'A Slider becomes controlled by passing both `value` and `onChange` props.', offerSpecialist: true };
  const resumeBody2 = {
    messages: [
      { id: 'msg_1', role: 'user', content: QUERY, parts: [{ type: 'text', text: QUERY }] },
      { id: 'msg_2', role: 'assistant', content: '', parts: [{ type: 'tool-invocation', toolInvocation: { state: 'result', toolCallId: tc1.toolCallId ?? tc1.id, toolName: 'call_generalist', args: { query: QUERY }, result: fakeGeneralistResult } }] },
    ],
  };
  const r2 = await fetch(url, { method: 'POST', headers: H_SEARCH, body: JSON.stringify(resumeBody2) });
  const t2 = await readStream(r2);
  const text2 = textFrom(t2);
  const tc2 = toolCallFrom(t2);
  console.log('\n=== ROUND 2: resume with offerSpecialist=true — expect a SECOND tool call ===');
  console.log(`HTTP ${r2.status}`);
  console.log(`text emitted (should be EMPTY): "${text2}"`);
  console.log(`tool call: ${tc2 ? JSON.stringify(tc2).slice(0, 300) : 'NONE — FAIL, chaining did not happen'}`);
  const round2Pass = text2.length === 0 && tc2 && tc2.toolName === 'call_specialist';
  console.log(`ROUND 2 VERDICT: ${round2Pass ? 'PASS — 2-deep tool-call chaining works' : 'FAIL'}`);
  writeFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', 'orchestrator-round2-frames.txt'), t2);
  if (!round2Pass) { await cleanup(); process.exit(1); }

  // --- Round 3: resume with a FAKE specialist result — does it end with ZERO text (never speaks)? ---
  const fakeSpecialistResult = { answer: 'Full code example: <Slider value={v} onChange={setV} />' };
  const resumeBody3 = {
    messages: [
      { id: 'msg_1', role: 'user', content: QUERY, parts: [{ type: 'text', text: QUERY }] },
      { id: 'msg_2', role: 'assistant', content: '', parts: [{ type: 'tool-invocation', toolInvocation: { state: 'result', toolCallId: tc1.toolCallId ?? tc1.id, toolName: 'call_generalist', args: { query: QUERY }, result: fakeGeneralistResult } }] },
      { id: 'msg_3', role: 'assistant', content: '', parts: [{ type: 'tool-invocation', toolInvocation: { state: 'result', toolCallId: tc2.toolCallId ?? tc2.id, toolName: 'call_specialist', args: { query: QUERY }, result: fakeSpecialistResult } }] },
    ],
  };
  const r3 = await fetch(url, { method: 'POST', headers: H_SEARCH, body: JSON.stringify(resumeBody3) });
  const t3 = await readStream(r3);
  const text3 = textFrom(t3);
  const tc3 = toolCallFrom(t3);
  console.log('\n=== ROUND 3: resume with specialist result — expect turn to end with NO text, no more tool calls ===');
  console.log(`HTTP ${r3.status}`);
  console.log(`text emitted (should be EMPTY): "${text3}"`);
  console.log(`unexpected tool call: ${tc3 ? JSON.stringify(tc3).slice(0, 300) : 'none (expected)'}`);
  const round3Pass = text3.length === 0 && !tc3;
  console.log(`ROUND 3 VERDICT: ${round3Pass ? 'PASS — orchestrator stayed silent to the end' : 'FAIL (harmless if short, but not zero-prose as designed)'}`);
  writeFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', 'orchestrator-round3-frames.txt'), t3);

  console.log('\n=== OVERALL ===');
  console.log(`Round 1 (forced tool-only): ${round1Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Round 2 (2-deep chaining):  ${round2Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Round 3 (silent to end):    ${round3Pass ? 'PASS' : 'FAIL (non-blocking)'}`);

  await cleanup();
  process.exit(round1Pass && round2Pass ? 0 : 1);
}

main().catch(async (e) => { console.error('FATAL', e); await cleanup(); process.exit(1); });
