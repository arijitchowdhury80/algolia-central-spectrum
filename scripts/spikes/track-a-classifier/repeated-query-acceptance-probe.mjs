// Task A8 — Acceptance gate: repeated-query live probe (the actual bug
// regression test, not the vitest suite). Self-contained raw-fetch script,
// same convention as scripts/spikes/agent-tool-handoff/*.mjs — does NOT
// import web/'s TS source (that's a design-time decision, not this task's;
// re-implements buildClassificationQuery's exact logic below and keeps it
// byte-identical to web/src/lib/classifier.ts on purpose).
//
// Method (per 05-plan.md Task A8):
//   1. Cold-call live production ACS-generic-neural (read-only) for a real
//      implementation-flavored question -> real answer + real hits.
//   2. Build the composite query exactly per buildClassificationQuery's
//      QUESTION/GENERIC'S ANSWER/RETRIEVED HITS (JSON) delimited shape.
//   3. POST the SAME byte-identical composite string to
//      ACS-classifier-neural-dev TWICE IN A ROW, raw captures both times.
//   4. Repeat for 4 total implementation-flavored pairs (mix of wordings).
//   5. Negative control: a repeated DESIGN-flavored pair must show NO
//      SPECIALIST: prefix, both times.
//
// Usage: node scripts/spikes/track-a-classifier/repeated-query-acceptance-probe.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '..', '.env.local')]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!envPath) { console.error('no .env.local found'); process.exit(1); }
const ENV = {};
for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV.ALGOLIA_APP_ID;
const SEARCH_KEY = ENV.ALGOLIA_SEARCH_API_KEY;
if (!APP || !SEARCH_KEY) { console.error('missing ALGOLIA_APP_ID / ALGOLIA_SEARCH_API_KEY in .env.local'); process.exit(1); }

// Read-only: live production Generic (never mutated, only POSTed /completions
// against — the exact call every real visitor already makes).
const GENERIC_LIVE = '95826da6-d1b6-4b81-b061-bfb52b881356';
// Disposable -dev classifier copy from Task A5, confirmed still live before
// this script was written (GET /agents/{id} -> status: published).
const CLASSIFIER_DEV = 'b4633a7b-95a7-4019-82df-9f5d8d4c1be5';

function url(agentId) {
  return `https://${APP}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-4`;
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

// Mirrors agentStudio.ts's collectHits exactly: routes any hit-shaped object
// (has url or title) found either directly in the tool result, in a
// `.hits` array, or in any array-valued key. Keeps FULL raw hit objects
// (body included) -- not a title/url subset -- so JSON.stringify(hits) below
// matches what a real browser client would actually send.
function collectHits(result, sink) {
  if (!result || typeof result !== 'object') return;
  const routeHit = (h) => {
    if (!h || typeof h !== 'object') return;
    if (h.url || h.title) sink.push(h);
  };
  if (Array.isArray(result)) { result.forEach(routeHit); return; }
  if (Array.isArray(result.hits)) { result.hits.forEach(routeHit); return; }
  for (const key of Object.keys(result)) {
    if (Array.isArray(result[key])) result[key].forEach(routeHit);
  }
}

// Raw completions call. `messages` is the full AI-SDK-shaped array (mirrors
// callCompletions's `[...history, {role:'user', content: query}]` — here we
// pass the already-flattened array directly since we control both call
// sites in this script).
async function callAgentRaw(agentId, messages) {
  const res = await fetch(url(agentId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Algolia-Application-Id': APP,
      'X-Algolia-API-Key': SEARCH_KEY,
    },
    body: JSON.stringify({ messages }),
  });
  const text = await readStream(res);
  const lines = text.split('\n').filter(Boolean);
  let content = '';
  const hits = [];
  for (const line of lines) {
    const c = line.indexOf(':');
    if (c < 0) continue;
    const prefix = line.slice(0, c);
    const payload = line.slice(c + 1);
    if (prefix === '0') {
      try { content += JSON.parse(payload); } catch { /* skip malformed delta */ }
    } else if (prefix === 'a') {
      try { collectHits(JSON.parse(payload).result, hits); } catch { /* skip malformed tool result */ }
    }
  }
  return { status: res.status, raw: text, content, hits };
}

/** Byte-identical port of web/src/lib/classifier.ts's buildClassificationQuery. */
function buildClassificationQuery(query, genericAnswer, hits) {
  return (
    `QUESTION:\n${query}\n\n` +
    `GENERIC'S ANSWER:\n${genericAnswer}\n\n` +
    `RETRIEVED HITS (JSON):\n${JSON.stringify(hits)}`
  );
}

/** Byte-identical port of web/src/lib/classifier.ts's parseClassifierResponse. */
function parseClassifierResponse(content) {
  return content.split('\n').map((l) => l.trim()).filter(Boolean);
}

async function coldCallGeneric(candidates) {
  for (const q of candidates) {
    const r = await callAgentRaw(GENERIC_LIVE, [{ role: 'user', content: q }]);
    console.log(`  [generic cold call] "${q}"`);
    console.log(`    HTTP ${r.status}  content=${r.content.length}ch  hits=${r.hits.length}`);
    if (r.hits.length > 0 && r.content.length > 0) {
      return { query: q, answer: r.content, hits: r.hits };
    }
    console.log('    -> 0 hits or 0 content (likely cache collision, per A5 precedent) -- discarding, trying next wording');
  }
  return null;
}

const IMPLEMENTATION_PAIRS = [
  [
    "What's the correct pattern for wiring an async, debounced data source into a Spectrum S2 ComboBox?",
    'How do I hook up an async, debounced onInputChange handler to load ComboBox options in React Spectrum S2?',
  ],
  [
    'Show me the code for adding keyboard-accessible multi-select row checkboxes to a Spectrum S2 TableView.',
    'How do I implement multi-select row checkboxes with keyboard navigation on a Spectrum S2 TableView, in code?',
  ],
  [
    'I need working TypeScript for a controlled multi-step wizard combining DialogTrigger and Tabs in React Spectrum S2 -- what is the pattern?',
    'How do I build a multi-step wizard flow using DialogTrigger and Tabs in React Spectrum S2, with a working code example?',
  ],
  [
    'What is the exact prop wiring to add custom async validation with an error message on a Spectrum S2 NumberField?',
    'How do I set up custom async validation and error state on a Spectrum S2 NumberField, with code?',
  ],
];

// NEG-CONTROL-1: a strategic/comparative framing -- deliberately kept even
// though (per the real run below) it turned out to be a genuinely ambiguous
// question the classifier's OWN prompt instructs it to default-SPECIALIST on
// ("If you are unsure whether a question is implementation-heavy, treat it as
// implementation-heavy" -- instructions_classifier.md). Kept in the report as
// a real, reportable finding, not discarded.
const DESIGN_PAIR_CANDIDATES = [
  "When should a team pick React Spectrum's design language over building a fully custom design system from scratch?",
  'What are the tradeoffs between adopting Spectrum as a design system versus maintaining a custom one?',
];

// NEG-CONTROL-2: an unambiguous pure-visual/token design question -- no
// strategic "should we adopt/build" framing that could read as ambiguous
// under the classifier's own tie-breaker rule. Isolates whether the
// mechanism itself is repeat-deterministic on a CLEAN negative case.
const DESIGN_PAIR_CANDIDATES_2 = [
  "What visual differences exist between Spectrum's light theme and dark theme color tokens?",
  "How does Spectrum's dark theme differ visually from its light theme in terms of color tokens?",
];

// NEG-CONTROL-3: A5's OWN exact design query (docs/spikes/2026-07-10-classifier-empirical-findings.md
// §2c/§3b), which A5 already empirically verified produced a clean
// non-SPECIALIST classification on 2026-07-10. Replaying it verbatim, fresh,
// isolates whether something has drifted since A5 or whether NO design
// wording reliably survives right now.
const DESIGN_PAIR_CANDIDATES_3 = [
  'When should I choose Spectrum over a custom design system instead of building my own?',
];

const results = [];

async function runImplementationPair(index, candidates) {
  console.log(`\n=== PAIR ${index} (implementation-flavored) ===`);
  const grounded = await coldCallGeneric(candidates);
  if (!grounded) {
    console.log('  FATAL: no candidate wording produced real hits -- cannot ground this pair.');
    results.push({ pair: `IMPL-${index}`, kind: 'implementation', status: 'FAIL', reason: 'no grounded generic capture (all candidates cache-collided or empty)' });
    return;
  }
  console.log(`  grounded on: "${grounded.query}"  (answer=${grounded.answer.length}ch, hits=${grounded.hits.length})`);
  const composite = buildClassificationQuery(grounded.query, grounded.answer, grounded.hits);
  console.log(`  composite length: ${composite.length} chars`);

  const call1 = await callAgentRaw(CLASSIFIER_DEV, [{ role: 'user', content: composite }]);
  const call2 = await callAgentRaw(CLASSIFIER_DEV, [{ role: 'user', content: composite }]);

  const lines1 = parseClassifierResponse(call1.content);
  const lines2 = parseClassifierResponse(call2.content);
  const specialist1 = lines1.find((l) => l.startsWith('SPECIALIST:'));
  const specialist2 = lines2.find((l) => l.startsWith('SPECIALIST:'));

  console.log('\n  --- Call 1 raw response ---');
  console.log('  ' + call1.raw.replace(/\n/g, '\n  '));
  console.log(`  extracted content: ${JSON.stringify(call1.content)}`);
  console.log('\n  --- Call 2 raw response (byte-identical composite POSTed again) ---');
  console.log('  ' + call2.raw.replace(/\n/g, '\n  '));
  console.log(`  extracted content: ${JSON.stringify(call2.content)}`);

  const pass = Boolean(specialist1) && Boolean(specialist2);
  console.log(`\n  Call 1 SPECIALIST: ${specialist1 ? `YES -> "${specialist1}"` : 'NO -- FAIL'}`);
  console.log(`  Call 2 SPECIALIST: ${specialist2 ? `YES -> "${specialist2}"` : 'NO -- FAIL'}`);
  console.log(`  PAIR ${index} VERDICT: ${pass ? 'PASS' : 'FAIL'}`);

  results.push({
    pair: `IMPL-${index}`,
    kind: 'implementation',
    query: grounded.query,
    hitsCount: grounded.hits.length,
    hitTitles: grounded.hits.map((h) => h.title).filter(Boolean),
    compositeLength: composite.length,
    call1Content: call1.content,
    call2Content: call2.content,
    specialist1,
    specialist2,
    status: pass ? 'PASS' : 'FAIL',
  });
}

async function runNegativeControl(label, candidates) {
  console.log(`\n=== ${label} (design-flavored, repeated) ===`);
  const grounded = await coldCallGeneric(candidates);
  if (!grounded) {
    console.log('  FATAL: no candidate wording produced real hits -- cannot ground the negative control.');
    results.push({ pair: label, kind: 'design', status: 'FAIL', reason: 'no grounded generic capture' });
    return;
  }
  console.log(`  grounded on: "${grounded.query}"  (answer=${grounded.answer.length}ch, hits=${grounded.hits.length})`);
  const composite = buildClassificationQuery(grounded.query, grounded.answer, grounded.hits);
  console.log(`  composite length: ${composite.length} chars`);

  const call1 = await callAgentRaw(CLASSIFIER_DEV, [{ role: 'user', content: composite }]);
  const call2 = await callAgentRaw(CLASSIFIER_DEV, [{ role: 'user', content: composite }]);

  const lines1 = parseClassifierResponse(call1.content);
  const lines2 = parseClassifierResponse(call2.content);
  const specialist1 = lines1.find((l) => l.startsWith('SPECIALIST:'));
  const specialist2 = lines2.find((l) => l.startsWith('SPECIALIST:'));

  console.log('\n  --- Call 1 raw response ---');
  console.log('  ' + call1.raw.replace(/\n/g, '\n  '));
  console.log(`  extracted content: ${JSON.stringify(call1.content)}`);
  console.log('\n  --- Call 2 raw response (byte-identical composite POSTed again) ---');
  console.log('  ' + call2.raw.replace(/\n/g, '\n  '));
  console.log(`  extracted content: ${JSON.stringify(call2.content)}`);

  const pass = !specialist1 && !specialist2;
  console.log(`\n  Call 1 SPECIALIST present: ${specialist1 ? `YES ("${specialist1}") -- FAIL` : 'no (expected)'}`);
  console.log(`  Call 2 SPECIALIST present: ${specialist2 ? `YES ("${specialist2}") -- FAIL` : 'no (expected)'}`);
  console.log(`  NEGATIVE CONTROL VERDICT: ${pass ? 'PASS' : 'FAIL'}`);

  results.push({
    pair: label,
    kind: 'design',
    query: grounded.query,
    hitsCount: grounded.hits.length,
    hitTitles: grounded.hits.map((h) => h.title).filter(Boolean),
    compositeLength: composite.length,
    call1Content: call1.content,
    call2Content: call2.content,
    specialist1,
    specialist2,
    status: pass ? 'PASS' : 'FAIL',
  });
}

async function main() {
  console.log(`Live production Generic: ${GENERIC_LIVE} (read-only)`);
  console.log(`Dev classifier target:   ${CLASSIFIER_DEV}`);

  for (let i = 0; i < IMPLEMENTATION_PAIRS.length; i++) {
    await runImplementationPair(i + 1, IMPLEMENTATION_PAIRS[i]);
  }
  await runNegativeControl('NEG-CONTROL-1', DESIGN_PAIR_CANDIDATES);
  await runNegativeControl('NEG-CONTROL-2', DESIGN_PAIR_CANDIDATES_2);
  await runNegativeControl('NEG-CONTROL-3', DESIGN_PAIR_CANDIDATES_3);

  console.log('\n\n=== SUMMARY TABLE ===');
  console.log('pair          | kind           | status | query');
  console.log('--------------|----------------|--------|------');
  for (const r of results) {
    console.log(`${r.pair.padEnd(13)} | ${r.kind.padEnd(14)} | ${r.status.padEnd(6)} | ${r.query ?? '(n/a: ' + (r.reason ?? 'unknown') + ')'}`);
  }

  const allPass = results.every((r) => r.status === 'PASS');
  console.log(`\nOVERALL: ${allPass ? 'PASS -- gate is green' : 'FAIL -- gate is NOT green, do not proceed to A9'}`);
  console.log('\n=== JSON RESULTS (for the findings doc) ===');
  console.log(JSON.stringify(results, null, 2));

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
