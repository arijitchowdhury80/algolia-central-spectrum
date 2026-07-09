// Calls the SPIKE-tool-probe agent's completions endpoint with a search-only
// key (same as the real browser client — see web/src/lib/agentStudio.ts),
// captures every raw SSE line, and reports whether a tool-call frame appears
// and whether the stream then STOPS (waiting for a client-supplied result) or
// Agent Studio just executes it server-side and keeps streaming (meaning it's
// NOT actually a client-executed tool despite the schema being accepted).
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
const [probeAgentId, query, outSuffix] = process.argv.slice(2);
if (!probeAgentId) { console.error('usage: node roundtrip-harness.mjs <probeAgentId> ["query"] [outSuffix]'); process.exit(1); }
const Q = query || 'How do I use a React Spectrum ComboBox?';

const url = `https://${APP}.algolia.net/agent-studio/1/agents/${probeAgentId}/completions?compatibilityMode=ai-sdk-4`;

// IMPORTANT (session lesson, SESSION.md): never read a streaming response with
// res.text() via node fetch — it intermittently truncates SSE bodies and those
// truncated empties get CACHED by Agent Studio, poisoning the query. Read the
// stream manually via the reader instead.
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Algolia-Application-Id': APP,
    'X-Algolia-API-Key': SEARCH_KEY,
  },
  body: JSON.stringify({ messages: [{ role: 'user', content: Q }] }),
});

console.log(`HTTP ${res.status}`);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let text = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  text += decoder.decode(value, { stream: true });
}

const outFile = join(__dirname, '..', '..', '..', 'docs', 'spikes', `roundtrip-frames${outSuffix ? '-' + outSuffix : ''}.txt`);
writeFileSync(outFile, text);
console.log(`wrote ${outFile}`);
console.log(text);
console.log('--- frame prefixes seen ---');
const lines = text.split('\n').filter(Boolean);
const prefixes = new Set(lines.map((l) => l.split(':')[0]));
console.log([...prefixes].join(', '));

const toolCallLine = lines.find((l) => l.startsWith('9:'));
const finalTextLines = lines.filter((l) => l.startsWith('0:'));
console.log('--- verdict ---');
console.log(`tool-call frame (9:) present: ${!!toolCallLine}`);
if (toolCallLine) console.log(`tool-call payload: ${toolCallLine}`);
console.log(`final text (0:) frames after tool-call: ${finalTextLines.length}`);
console.log(finalTextLines.length === 0 && toolCallLine
  ? 'PAUSED — stream ended after tool call, no answer. Genuine client-executed pause.'
  : toolCallLine
    ? 'DID NOT PAUSE — tool-call frame appeared but stream continued with a final answer anyway.'
    : 'NO TOOL CALL — agent answered directly without invoking the tool.');
