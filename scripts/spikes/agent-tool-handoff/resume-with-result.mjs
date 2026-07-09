// Gets a REAL answer from ACS-technical-neural, then tries several candidate
// wire shapes for resuming the probe agent's paused turn with that answer as
// the client_side tool's result. No shape is documented for plain client_side
// (function) tools — only the mcp_tools approval flow is spelled out — so this
// probes candidates empirically and reports which one(s) the API accepts, and
// whether the returned final answer actually folds in the specialist content.
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
const APP = ENV.ALGOLIA_APP_ID;
const SEARCH_KEY = ENV.ALGOLIA_SEARCH_API_KEY;
const TECHNICAL_AGENT_ID = '63ab0c86-3493-416b-a771-a820ab25d83d'; // real ACS-technical-neural

const [probeAgentId, toolCallId, query] = process.argv.slice(2);
if (!probeAgentId || !toolCallId || !query) {
  console.error('usage: node resume-with-result.mjs <probeAgentId> <toolCallId> "<original query>"');
  process.exit(1);
}

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

// 1. Get a real specialist answer to use as the tool result.
const techRes = await fetch(
  `https://${APP}.algolia.net/agent-studio/1/agents/${TECHNICAL_AGENT_ID}/completions?compatibilityMode=ai-sdk-4`,
  { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': SEARCH_KEY }, body: JSON.stringify({ messages: [{ role: 'user', content: query }] }) },
);
const techText = await readStream(techRes);
const specialistAnswer = techText.split('\n').filter((l) => l.startsWith('0:')).map((l) => { try { return JSON.parse(l.slice(2)); } catch { return ''; } }).join('');
console.log(`specialist answer (${specialistAnswer.length} chars): ${specialistAnswer.slice(0, 200)}...`);
if (!specialistAnswer) { console.error('FATAL: specialist returned no 0: text frames — cannot test resume without real content'); process.exit(1); }

const url = `https://${APP}.algolia.net/agent-studio/1/agents/${probeAgentId}/completions?compatibilityMode=ai-sdk-4`;
const H = { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': SEARCH_KEY };

const candidates = [
  {
    label: 'A: assistant.toolInvocations state=result (AI-SDK v4 useChat convention)',
    body: {
      messages: [
        { role: 'user', content: query },
        { role: 'assistant', content: '', toolInvocations: [{ toolCallId, toolName: 'consult_technical_specialist', args: { query }, state: 'result', result: specialistAnswer }] },
      ],
    },
  },
  {
    label: 'B: OpenAI-style tool_calls + role:tool message',
    body: {
      messages: [
        { role: 'user', content: query },
        { role: 'assistant', content: null, tool_calls: [{ id: toolCallId, type: 'function', function: { name: 'consult_technical_specialist', arguments: JSON.stringify({ query }) } }] },
        { role: 'tool', tool_call_id: toolCallId, content: specialistAnswer },
      ],
    },
  },
  {
    label: 'C: message parts with type tool-result (mirrors docs tool-approval-request shape)',
    body: {
      messages: [
        { id: 'msg_1', role: 'user', content: query, parts: [{ type: 'text', text: query }] },
        { id: 'msg_2', role: 'assistant', content: '', parts: [{ type: 'tool-result', toolCallId, toolName: 'consult_technical_specialist', result: specialistAnswer }] },
      ],
    },
  },
  {
    label: 'D: AI-SDK v4 UIPart tool-invocation (state=result), nested toolInvocation object',
    body: {
      messages: [
        { id: 'msg_1', role: 'user', content: query, parts: [{ type: 'text', text: query }] },
        {
          id: 'msg_2', role: 'assistant', content: '',
          parts: [{ type: 'tool-invocation', toolInvocation: { state: 'result', toolCallId, toolName: 'consult_technical_specialist', args: { query }, result: specialistAnswer } }],
        },
      ],
    },
  },
  {
    label: 'E: same as D but top-level toolInvocations array too (belt+suspenders)',
    body: {
      messages: [
        { id: 'msg_1', role: 'user', content: query, parts: [{ type: 'text', text: query }] },
        {
          id: 'msg_2', role: 'assistant', content: '',
          toolInvocations: [{ state: 'result', toolCallId, toolName: 'consult_technical_specialist', args: { query }, result: specialistAnswer }],
          parts: [{ type: 'tool-invocation', toolInvocation: { state: 'result', toolCallId, toolName: 'consult_technical_specialist', args: { query }, result: specialistAnswer } }],
        },
      ],
    },
  },
];

for (const { label, body } of candidates) {
  const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await readStream(res);
  console.log(`\n=== candidate ${label} ===`);
  console.log(`HTTP ${res.status}`);
  console.log(text.slice(0, 1500));
  const finalTextFrames = text.split('\n').filter((l) => l.startsWith('0:'));
  const gotAnswer = finalTextFrames.length > 0;
  console.log(`final 0: text frames: ${finalTextFrames.length} — ${gotAnswer ? 'RESUMED with an answer' : 'no answer'}`);
  if (gotAnswer) {
    writeFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', 'resume-frames.txt'), text);
    console.log('*** wrote docs/spikes/resume-frames.txt — this candidate worked, stopping loop ***');
    break;
  }
}
