# Agent-to-Agent Client-Tool Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine, with real evidence (not docs-reading alone), whether Algolia Agent Studio supports a client-executed ("call this webhook / return control to caller") tool type — and if it does, prove out a minimal agent-to-agent round trip (Generic → tool call → client posts back Technical's answer as the tool result) — WITHOUT touching the production `ACS-generic-neural` / `ACS-technical-neural` agents or `web/src/hooks/useChat.ts`.

**Architecture:** Disposable spike agent(s) created via the Agent Studio admin API (same pattern as `scripts/agents/build_acs_agents.mjs`), probed with a small Node harness that captures raw SSE frames. Everything lives under `scripts/spikes/agent-tool-handoff/` and `docs/spikes/` — nothing here is wired into the real app. Decision gate after Task 3: if the platform doesn't support client-executed tools, stop, write the NO-GO finding, and fall back to the previously-agreed cheap fix (generalize the `[[HANDOFF:x]]` sentinel into a registry) instead of this architecture.

**Tech Stack:** Node.js (`node:fs`, native `fetch`), Algolia Agent Studio REST API (`https://{appId}.algolia.net/agent-studio/1`), admin key from `.env.local` (never hardcoded — same loader pattern as `build_acs_agents.mjs`).

## Global Constraints

- Never hardcode `ALGOLIA_APP_ID` / `ALGOLIA_ADMIN_API_KEY` — load from `.env.local` exactly like `scripts/agents/build_acs_agents.mjs:16-18` does.
- Never touch `ACS-generic-neural` (`13809d4b-6b6d-4297-b95c-a934bceef0b4`) or `ACS-technical-neural` (`63ab0c86-3493-416b-a771-a820ab25d83d`) — all spike agents get a `SPIKE-` name prefix so they're trivially distinguishable and bulk-deletable.
- Every spike agent created must be deleted by Task 10 — this is a throwaway probe, not a new permanent fixture.
- Admin key is script-only (matches project's standing browser/admin key separation rule) — nothing in this plan touches browser code.
- Record every finding to disk in `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md` as you go — don't hold conclusions in conversation only.

---

### Task 1: Capture baseline — dump today's real agent/tool schema

**Files:**
- Create: `scripts/spikes/agent-tool-handoff/dump-agent.mjs`
- Create: `docs/spikes/baseline-ACS-generic-neural.json` (output, gitignored-safe — contains no secrets, just agent config)

**Interfaces:**
- Produces: `docs/spikes/baseline-ACS-generic-neural.json` — the exact current tool schema shape, consumed by Task 3 to know what fields a "normal" (index-search) tool has, so we can tell a client/webhook tool type apart from it.

- [ ] **Step 1: Write the dump script**

```javascript
// scripts/spikes/agent-tool-handoff/dump-agent.mjs
// Dumps a published agent's full JSON so we can inspect its real tool schema.
// Usage: node dump-agent.mjs <agentId> <outFile>
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
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
const APP = ENV.ALGOLIA_APP_ID, KEY = ENV.ALGOLIA_ADMIN_API_KEY;
const BASE = `https://${APP}.algolia.net/agent-studio/1`;
const H = { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' };

const [agentId, outFile] = process.argv.slice(2);
if (!agentId || !outFile) { console.error('usage: node dump-agent.mjs <agentId> <outFile>'); process.exit(1); }

const r = await fetch(`${BASE}/agents/${agentId}`, { headers: H });
const body = await r.text();
if (r.status !== 200) { console.error(`GET /agents/${agentId} -> ${r.status}: ${body.slice(0, 400)}`); process.exit(1); }
const json = JSON.parse(body);

mkdirSync(join(__dirname, '..', '..', '..', 'docs', 'spikes'), { recursive: true });
writeFileSync(outFile, JSON.stringify(json, null, 2));
console.log(`wrote ${outFile}`);
console.log(`tool count: ${json.tools?.length ?? 0}`);
console.log(`tool[0] keys: ${json.tools?.[0] ? Object.keys(json.tools[0]).join(', ') : '(none)'}`);
console.log(`tool[0].type field: ${json.tools?.[0]?.type ?? '(no "type" field present)'}`);
```

- [ ] **Step 2: Run it against the real Generic agent (read-only GET, zero risk)**

```bash
cd /Users/arijitchowdhury/Dropbox/AI-Development/RAG/Algolia-Central-Spectrum
node scripts/spikes/agent-tool-handoff/dump-agent.mjs 13809d4b-6b6d-4297-b95c-a934bceef0b4 docs/spikes/baseline-ACS-generic-neural.json
```

Expected: prints `tool count: 1` (or however many tools exist today), and `tool[0] keys: ...`. Read the printed key list — record in the findings doc whether a `type` discriminator field exists at all on today's tool object, and what value it holds if so.

- [ ] **Step 3: Record the finding**

Append to `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md` (create it):

```markdown
# Agent-to-Agent Client-Tool Spike — Findings Log

## Task 1: Baseline tool schema
- Agent probed: ACS-generic-neural (13809d4b-6b6d-4297-b95c-a934bceef0b4)
- Tool count: <fill from script output>
- Tool[0] top-level keys: <fill from script output>
- Tool "type" field present? <yes/no> — value if present: <value>
- Conclusion: today's tool = <index-search only | other — describe>
```

- [ ] **Step 4: Commit**

```bash
git add scripts/spikes/agent-tool-handoff/dump-agent.mjs docs/spikes/baseline-ACS-generic-neural.json docs/spikes/2026-07-08-agent-to-agent-tool-findings.md
git commit -m "spike: capture baseline Agent Studio tool schema"
```

---

### Task 2: Docs check — does Agent Studio document a client/webhook/function tool type?

**Files:**
- Modify: `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md`
- Create: `docs/spikes/candidate-tool-schema.json` (only if a candidate shape is found)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `docs/spikes/candidate-tool-schema.json` — the exact JSON shape Task 3 will try to POST. If no candidate is found, this file is NOT created and Task 3 is skipped (go straight to the NO-GO path in Task 4).

- [ ] **Step 1: Search Algolia's official Agent Studio API reference for tool types**

Use WebFetch against Algolia's Agent Studio API documentation (start at `https://www.algolia.com/doc/` search for "Agent Studio" and "tools", follow to the agent-creation / tool-schema reference page). Look specifically for:
- A `type` or `kind` field on tool objects with values other than the index-search shape we saw in Task 1 (e.g. `"function"`, `"webhook"`, `"client"`, `"custom"`, `"http"`).
- Any mention of "human in the loop", "client tool", "return control", "tool result callback", or a second endpoint (distinct from `/completions`) for submitting a tool result back into a paused turn.
- Any mention of agent-to-agent, sub-agent, or agent handoff as a first-class Agent Studio concept (would make this spike partially moot if it already exists).

- [ ] **Step 2: Record exact findings, verbatim, with source URL**

```markdown
## Task 2: Docs research
- URL(s) checked: <exact URLs fetched>
- Documented tool types found: <list, verbatim from docs, or "only index-search documented">
- Client-executed / webhook / function tool type exists? <yes/no/unclear>
- If yes: exact schema fields required, pasted verbatim: <paste>
- Resume/continue endpoint for posting a tool result back exists? <yes/no + endpoint if yes>
- Native agent-to-agent / handoff concept documented? <yes/no + detail>
```

- [ ] **Step 3: If a candidate schema was found, save it as the Task 3 input**

Write the exact candidate tool JSON (from docs, adapted to this project's index/agent IDs) to `docs/spikes/candidate-tool-schema.json`. If nothing usable was found, skip this step — write `NO CANDIDATE FOUND` in the findings doc instead and proceed directly to Task 4's NO-GO branch.

- [ ] **Step 4: Commit**

```bash
git add docs/spikes/2026-07-08-agent-to-agent-tool-findings.md docs/spikes/candidate-tool-schema.json 2>/dev/null
git commit -m "spike: record Agent Studio tool-type docs research"
```

---

### Task 3: Capability probe — try to create an agent with the candidate tool type

**Skip this entire task if Task 2 found no candidate schema — go directly to Task 4 and record NO-GO.**

**Files:**
- Create: `scripts/spikes/agent-tool-handoff/create-probe-agent.mjs`
- Modify: `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md`

**Interfaces:**
- Consumes: `docs/spikes/candidate-tool-schema.json` (Task 2 output).
- Produces: a live agent named `SPIKE-tool-probe` in Agent Studio (or confirmation that creation was rejected) — consumed by Task 5 if it succeeds, by Task 10 for cleanup either way.

- [ ] **Step 1: Write the probe-creation script**

```javascript
// scripts/spikes/agent-tool-handoff/create-probe-agent.mjs
// Attempts to create a disposable agent using the candidate client-tool schema
// from Task 2. A 2xx here means Agent Studio ACCEPTS the shape (capability
// exists at the schema-validation level, still needs Task 5 to confirm runtime
// behavior). A 4xx means it's rejected — record the exact error, that's the
// NO-GO signal.
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

// Reuse the real Generic agent's model/provider so the probe agent behaves
// like a normal published agent — only the tools array differs.
const baseId = '13809d4b-6b6d-4297-b95c-a934bceef0b4'; // ACS-generic-neural
const base = await (await fetch(`${BASE}/agents/${baseId}`, { headers: H })).json();

const body = {
  name: 'SPIKE-tool-probe',
  instructions: 'You are a test agent. When the user asks any question, call the `consult_specialist` tool with their question as the `query` argument, then relay whatever it returns verbatim.',
  model: base.model,
  providerId: base.providerId ?? base.provider_id,
  tools: [candidateTool],
  status: 'published',
};

const r = await fetch(`${BASE}/agents`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const text = await r.text();
console.log(`POST /agents -> ${r.status}`);
console.log(text.slice(0, 2000));
```

- [ ] **Step 2: Run it**

```bash
node scripts/spikes/agent-tool-handoff/create-probe-agent.mjs
```

Expected: either `POST /agents -> 200` (or 201) with the created agent's `id` in the response, or a 4xx with a validation error naming the rejected field.

- [ ] **Step 3: Record the result**

```markdown
## Task 3: Capability probe
- Candidate schema tried: <paste candidateTool JSON>
- Result: HTTP <status>
- Response body (first 500 chars): <paste>
- If rejected: exact field/reason cited by the error: <paste>
- Verdict: <ACCEPTED — proceed to Task 5 | REJECTED — go to Task 4 NO-GO>
```

- [ ] **Step 4: Commit**

```bash
git add scripts/spikes/agent-tool-handoff/create-probe-agent.mjs docs/spikes/2026-07-08-agent-to-agent-tool-findings.md
git commit -m "spike: probe Agent Studio client-tool creation"
```

---

### Task 4: GO/NO-GO gate

**Files:**
- Modify: `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md`

**Interfaces:**
- Consumes: Task 2 + Task 3 verdicts.
- Produces: the gate decision that Task 5 onward depends on.

- [ ] **Step 1: Write the gate decision**

```markdown
## Task 4: GO/NO-GO gate
- Decision: <GO | NO-GO>
- Reasoning: <one paragraph, citing the Task 2 docs finding and Task 3 HTTP result>
- If NO-GO: recommended fallback = generalize `[[HANDOFF:<agentKey>]]` sentinel in
  web/src/lib/agents.ts + useChat.ts into a keyed registry (activeInstance.agents
  map) instead of hardcoded .generic/.technical fields. This gets N-agent scaling
  today without waiting on an Agent Studio platform capability that doesn't exist.
- If GO: proceed to Task 5.
```

- [ ] **Step 2: If NO-GO, stop here and skip to Task 10 (cleanup).** If GO, continue to Task 5.

- [ ] **Step 3: Commit**

```bash
git add docs/spikes/2026-07-08-agent-to-agent-tool-findings.md
git commit -m "spike: record GO/NO-GO decision on client-tool capability"
```

---

### Task 5: Round-trip probe — confirm the turn actually pauses for a client-supplied tool result

**Only run this task if Task 4 = GO.**

**Files:**
- Create: `scripts/spikes/agent-tool-handoff/roundtrip-harness.mjs`
- Modify: `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md`

**Interfaces:**
- Consumes: the `SPIKE-tool-probe` agent id from Task 3's response.
- Produces: raw captured SSE frames at `docs/spikes/roundtrip-frames.txt`, consumed by Task 6.

- [ ] **Step 1: Write the harness**

```javascript
// scripts/spikes/agent-tool-handoff/roundtrip-harness.mjs
// Calls the SPIKE-tool-probe agent's completions endpoint with a search-only
// key (same as the real browser client does — see web/src/lib/agentStudio.ts),
// captures every raw SSE line, and prints/saves them so we can see whether a
// `9:` tool_call frame appears and whether the stream then STOPS (waiting for
// a client-supplied result) or Agent Studio just executes it server-side and
// keeps streaming (meaning it's NOT actually a client-executed tool).
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
const SEARCH_KEY = ENV.ALGOLIA_SEARCH_API_KEY; // browser-safe key, matches production client
const [probeAgentId] = process.argv.slice(2);
if (!probeAgentId) { console.error('usage: node roundtrip-harness.mjs <probeAgentId>'); process.exit(1); }

const url = `https://${APP}.algolia.net/agent-studio/1/agents/${probeAgentId}/completions?compatibilityMode=ai-sdk-4`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Algolia-Application-Id': APP,
    'X-Algolia-API-Key': SEARCH_KEY,
  },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'How do I use a React Spectrum ComboBox?' }] }),
});

console.log(`HTTP ${res.status}`);
const text = await res.text();
writeFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', 'roundtrip-frames.txt'), text);
console.log(text);
console.log('--- frame prefixes seen ---');
const prefixes = new Set(text.split('\n').filter(Boolean).map((l) => l.split(':')[0]));
console.log([...prefixes].join(', '));
```

- [ ] **Step 2: Run it against the probe agent's real id (printed by Task 3's script)**

```bash
node scripts/spikes/agent-tool-handoff/roundtrip-harness.mjs <SPIKE-tool-probe agent id from Task 3 output>
```

Expected one of two outcomes — record which:
- **(a) Turn pauses:** a `9:` frame appears with `toolName: "consult_specialist"` and args, then the stream ENDS with no `0:` text frames after it (no final answer) — this is the "client must execute and post back" signature.
- **(b) Turn completes anyway:** Agent Studio executes the tool itself server-side (e.g. it silently ignores the "client" designation and treats it as another index tool, or errors), and a full `0:` text answer streams through with no pause. This means it's NOT a real client-executed tool despite what the schema accepted in Task 3.

- [ ] **Step 3: Record the result**

```markdown
## Task 5: Round-trip pause behavior
- Frame prefixes observed: <paste from script output>
- Tool call frame (`9:`) present? <yes/no> — payload: <paste>
- Stream ended after tool call with no final answer (paused)? <yes/no>
- Verdict: <(a) genuine client-executed pause | (b) server executed it / ignored client designation — NO-GO, update Task 4 gate to NO-GO and stop>
```

- [ ] **Step 4: Commit**

```bash
git add scripts/spikes/agent-tool-handoff/roundtrip-harness.mjs docs/spikes/roundtrip-frames.txt docs/spikes/2026-07-08-agent-to-agent-tool-findings.md
git commit -m "spike: capture round-trip tool-call pause behavior"
```

---

### Task 6: Post the tool result back and confirm the turn resumes

**Only run if Task 5 verdict = (a) genuine pause.**

**Files:**
- Create: `scripts/spikes/agent-tool-handoff/resume-with-result.mjs`
- Modify: `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md`

**Interfaces:**
- Consumes: the `tool_call_id` / `toolName` / `args` captured in Task 5's frame dump, and the real `ACS-technical-neural` completions endpoint (called for a REAL answer to feed back as the tool result — proves this is genuinely agent-to-agent, not a canned string).
- Produces: `docs/spikes/resume-frames.txt`, the final evidence artifact for the GO decision.

- [ ] **Step 1: Write the resume script**

Per whatever Task 2's docs research found for "submitting a tool result back into a paused turn" (likely: resubmit `/completions` with the full message history PLUS a `{role: 'tool', tool_call_id, content}` entry — mirror whatever the docs specify exactly; do not guess if the docs gave an exact shape).

```javascript
// scripts/spikes/agent-tool-handoff/resume-with-result.mjs
// Takes the tool_call captured in Task 5, calls the REAL ACS-technical-neural
// agent to get a genuine answer, then resubmits the probe agent's completions
// call with that answer as the tool result — per the resume contract found in
// Task 2's docs research (fill in the exact message shape there specifies).
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

// Get a real specialist answer to use as the tool result.
const techRes = await fetch(
  `https://${APP}.algolia.net/agent-studio/1/agents/${TECHNICAL_AGENT_ID}/completions?compatibilityMode=ai-sdk-4`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': SEARCH_KEY },
    body: JSON.stringify({ messages: [{ role: 'user', content: query }] }),
  },
);
const techText = await techRes.text();
const specialistAnswer = techText
  .split('\n')
  .filter((l) => l.startsWith('0:'))
  .map((l) => { try { return JSON.parse(l.slice(2)); } catch { return ''; } })
  .join('');

// Resubmit to the probe agent with the tool result appended.
// NOTE: exact message shape here MUST match whatever Task 2's docs research
// found for submitting tool results — this is a first attempt using the
// AI-SDK-v4 convention (role: 'tool'); adjust per actual docs before running.
const resumeBody = {
  messages: [
    { role: 'user', content: query },
    { role: 'tool', tool_call_id: toolCallId, content: specialistAnswer },
  ],
};
const resumeRes = await fetch(
  `https://${APP}.algolia.net/agent-studio/1/agents/${probeAgentId}/completions?compatibilityMode=ai-sdk-4`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': SEARCH_KEY },
    body: JSON.stringify(resumeBody),
  },
);
console.log(`resume HTTP ${resumeRes.status}`);
const resumeText = await resumeRes.text();
writeFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', 'resume-frames.txt'), resumeText);
console.log(resumeText);
```

- [ ] **Step 2: Run it** using the `tool_call_id` and original query from Task 5

```bash
node scripts/spikes/agent-tool-handoff/resume-with-result.mjs <probeAgentId> <toolCallId> "How do I use a React Spectrum ComboBox?"
```

Expected: HTTP 200 with a `0:` text stream containing the probe agent's final answer, which should read as a relay/synthesis of the real Technical agent's answer (proves the round trip actually folds specialist content back in).

- [ ] **Step 3: Record the result**

```markdown
## Task 6: Resume with real tool result
- Resume HTTP status: <fill>
- Final answer contains specialist content? <yes/no> — paste final answer
- Verdict: <CONFIRMED full agent-to-agent round trip works | FAILED — paste error, this becomes the binding NO-GO fact even if Task 3/5 looked promising>
```

- [ ] **Step 4: Commit**

```bash
git add scripts/spikes/agent-tool-handoff/resume-with-result.mjs docs/spikes/resume-frames.txt docs/spikes/2026-07-08-agent-to-agent-tool-findings.md
git commit -m "spike: confirm tool-result resume round trip"
```

---

### Task 7: Failure-mode checks

**Only run if Task 6 = CONFIRMED.**

**Files:**
- Modify: `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md`

**Interfaces:**
- Consumes: `roundtrip-harness.mjs`, `resume-with-result.mjs` (reused, not modified).

- [ ] **Step 1: Timeout case** — run `roundtrip-harness.mjs` to trigger the tool call, then wait 2 minutes before running `resume-with-result.mjs`. Record: does the resume still work, or has the turn expired? What HTTP status/error on expiry?

- [ ] **Step 2: Error-injection case** — modify `resume-with-result.mjs`'s `specialistAnswer` locally to a call against a deliberately wrong agent id (to simulate the specialist erroring), run the resume, and record how the probe agent's final answer handles a failed/empty tool result (does it hallucinate, refuse, or surface the error to the user?).

- [ ] **Step 3: Record both findings**

```markdown
## Task 7: Failure modes
- Timeout behavior (2 min delay before resume): <describe result + any error>
- Error-injection behavior (bad tool result content): <describe how the agent's final answer handled it>
- Risk assessment: <e.g. "no server-side timeout enforcement seen — client must enforce its own cap" or whatever was actually observed>
```

- [ ] **Step 4: Commit**

```bash
git add docs/spikes/2026-07-08-agent-to-agent-tool-findings.md
git commit -m "spike: record timeout and error-injection failure modes"
```

---

### Task 8: Latency comparison

**Only run if Task 6 = CONFIRMED.**

**Files:**
- Modify: `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md`

- [ ] **Step 1: Measure today's 2-call frontend approach** — time `callCompletions` to Generic + `callCompletions` to Technical sequentially (the current `useChat.ts` flow) for the same query used in Task 5/6, using `Date.now()` around each call in a throwaway local script (not committed to production code).

- [ ] **Step 2: Measure the spike's round trip** — sum the wall-clock time of Task 5's initial call + Task 6's resume call for the same query.

- [ ] **Step 3: Record the comparison**

```markdown
## Task 8: Latency comparison
- Current frontend-orchestrator (Generic + Technical, sequential): <ms>
- Spike client-tool round trip (initial + resume): <ms>
- Delta: <ms, % slower/faster>
- User-visible impact: <e.g. "today's design streams Generic's answer immediately, then streams Technical on click — spike's design has no visible output until BOTH legs complete, since the tool-call pause blocks the first response text". Confirm or refute this from what you actually observed in Task 5/6's frame dumps.>
```

- [ ] **Step 4: Commit**

```bash
git add docs/spikes/2026-07-08-agent-to-agent-tool-findings.md
git commit -m "spike: record latency comparison vs current frontend-orchestrator"
```

---

### Task 9: Write the final GO/NO-GO recommendation

**Files:**
- Create: `docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md`

**Interfaces:**
- Consumes: every prior task's findings section.
- Produces: the single document that answers the architecture debate — feeds directly back into the earlier decision between "native client tool" and "generalized sentinel registry".

- [ ] **Step 1: Write the verdict doc**

```markdown
# Agent-to-Agent Client-Tool Spike — Verdict

**Date:** 2026-07-08
**Question:** Can Architecture B (client tool on source agent calls target agent) replace the current frontend-sentinel orchestration in useChat.ts?

**Verdict:** <GO | NO-GO | GO-WITH-CAVEATS>

**Evidence summary:**
- Schema acceptance (Task 3): <one line>
- Real pause-for-client behavior (Task 5): <one line>
- Full round trip with real specialist content (Task 6): <one line>
- Failure modes (Task 7): <one line>
- Latency vs current design (Task 8): <one line>

**Recommendation:**
<If GO: describe the concrete next implementation step — e.g. "replace the sentinel-parsing in useChat.ts with tool-call-frame interception; one tool per specialist; frontend still gates on human click before posting the result back, preserving today's UX." Reference exact files to change: web/src/lib/agentStudio.ts (add tool-call/resume support), web/src/hooks/useChat.ts (replace parseAgentText sentinel logic), scripts/agents/build_acs_agents.mjs (register a client tool per specialist instead of scoping tools by filter).>

<If NO-GO: confirm fallback — generalize the sentinel into a registry (web/src/lib/agents.ts: change `agents.generic.id`/`agents.technical.id` fixed fields into a `Record<string, {id: string}>` keyed map; useChat.ts: replace the single `deepDiveOffered` boolean + hardcoded second segment with a loop over parsed `[[HANDOFF:<key>]]` tokens). This is a SEPARATE plan, not covered by this spike.>
```

- [ ] **Step 2: Commit**

```bash
git add docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md
git commit -m "spike: final GO/NO-GO verdict on agent-to-agent client tool"
```

---

### Task 10: Cleanup — delete every spike agent, confirm zero collateral change

**Files:**
- Create: `scripts/spikes/agent-tool-handoff/cleanup.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: confirmation that `ACS-generic-neural` and `ACS-technical-neural` are byte-identical to Task 1's baseline dump (proves the spike touched nothing real).

- [ ] **Step 1: Write the cleanup + verification script**

```javascript
// scripts/spikes/agent-tool-handoff/cleanup.mjs
// Deletes every SPIKE-* agent and re-dumps ACS-generic-neural to diff against
// the Task 1 baseline, proving the spike left production agents untouched.
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

// Re-dump Generic and diff key fields against baseline.
const baseline = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'docs', 'spikes', 'baseline-ACS-generic-neural.json'), 'utf8'));
const now = await (await fetch(`${BASE}/agents/13809d4b-6b6d-4297-b95c-a934bceef0b4`, { headers: H })).json();
const same = JSON.stringify(baseline.tools) === JSON.stringify(now.tools) && baseline.instructions === now.instructions;
console.log(`ACS-generic-neural tools+instructions unchanged since baseline: ${same}`);
if (!same) console.error('WARNING: production agent drifted during the spike — investigate before trusting the verdict.');
```

- [ ] **Step 2: Run it**

```bash
node scripts/spikes/agent-tool-handoff/cleanup.mjs
```

Expected: every `SPIKE-` agent deleted (HTTP 200/204 each), and `tools+instructions unchanged since baseline: true`.

- [ ] **Step 3: Record final confirmation and commit**

```markdown
## Task 10: Cleanup confirmation
- Spike agents deleted: <list + statuses>
- Production agent drift check: <PASS/FAIL — paste script output>
```

```bash
git add scripts/spikes/agent-tool-handoff/cleanup.mjs docs/spikes/2026-07-08-agent-to-agent-tool-findings.md
git commit -m "spike: cleanup disposable agents, confirm zero production drift"
```
