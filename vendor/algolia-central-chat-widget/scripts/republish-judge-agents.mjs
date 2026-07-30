#!/usr/bin/env node
/**
 * republish-judge-agents.mjs
 *
 * Re-publishes the three blind judge agents (Skeptic / Referee / Advocate) with
 * rubric-agnostic instructions, so the rubric in this repo is the single source
 * of truth for scoring.
 *
 * ## Why this exists
 *
 * The judge agents had a frozen snapshot of an OLD prompt baked into their Agent
 * Studio instructions, including its own rubric:
 *
 *     RUBRIC "Algolia answer quality v4 (usefulness + grounding gate)"
 *     - usefulness ("Usefulness", weight x1): the ONE thing you score
 *
 * Every judge call already sends the full current rubric (see
 * `chat-central/src/judge/engine/prompt.ts`), but a system instruction outranks
 * the message, so the judges answered with a single `usefulness` dimension:
 *
 *     { "dimensionScores": [{ "dimensionId": "usefulness", "score": 10, … }] }
 *
 * Nothing in the pipeline maps `usefulness` onto the rubric's four dimensions
 * (grounding / coverage / depth / relevance), so `weightedAggregate` defaulted
 * every dimension to `rubric.min` (1) and `toFinalScale(1)` rendered **0.0/10**
 * for every judge and every bar — while the prose `summary` still read as glowing
 * praise, and an empty `groundingViolations` left the badge on GROUNDED.
 *
 * The fix is NOT to bake the current four dimensions in instead: that is the same
 * trap one rubric revision later. These agents are dumb scoring backends that
 * follow whatever rubric the request carries, mirroring the existing
 * `ACS-judge-neural` agent, which was already written this way and never drifted.
 *
 * ## Usage
 *
 *   ALGOLIA_ADMIN_KEY=<admin_key> node scripts/republish-judge-agents.mjs
 *   node scripts/republish-judge-agents.mjs --dry-run   # print, change nothing
 *
 * Idempotent: safe to re-run. The previous instructions of every agent it touches
 * are written to scripts/judge-agent-backups/ before anything is overwritten.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

const APP_ID = '0EXRPAXB56';

const DRY_RUN = process.argv.includes('--dry-run');

const ADMIN_KEY =
  process.env.ALGOLIA_ADMIN_KEY ??
  process.argv.find((a) => !a.startsWith('-') && a.length === 32) ??
  'REDACTED';

const BASE_URL = `https://${APP_ID}.algolia.net/agent-studio/1/agents`;

const HEADERS = {
  'Content-Type': 'application/json',
  'X-Algolia-Application-Id': APP_ID,
  'X-Algolia-API-Key': ADMIN_KEY,
};

/** The judge agents this script owns, by Agent Studio name. */
const JUDGE_AGENT_NAMES = ['ACS-judge-skeptic', 'ACS-judge-referee', 'ACS-judge-advocate'];

// ── Instructions ─────────────────────────────────────────────────────────────

/**
 * Deliberately carries NO rubric, NO persona, and NO output schema.
 *
 * All three are supplied per request by `buildJudgePrompt`, which sends the
 * blinding instruction, `YOUR LENS: <persona>` for this judge's temperament, the
 * rubric with every dimension id and description, and `JUDGE_OUTPUT_CONTRACT`.
 * Restating any of it here creates a second source of truth that silently wins
 * when the two disagree — the bug this script fixes.
 */
const JUDGE_INSTRUCTIONS = `# Judge backend — blind scoring engine (ACS panel — no search, no chat)

## Role & scope

You are an internal, invisible scoring backend for a blind judging panel. You are
**never shown to the end user** and you **never answer the end user's question**.
You have **no search tool** — you do not retrieve anything yourself, and you never
claim to.

You are a general-purpose evaluation engine. Every turn, you receive a single
message that fully specifies the scoring task: the persona to adopt, the rubric to
apply, the artifact to score, the sources it was allowed to use, and the exact
output format required. Your entire job is to **follow that message literally** and
return **only** what it asks for.

## The message is authoritative

- **Adopt the persona the message gives you** (its "YOUR LENS" section). That lens
  is your scoring temperament for this turn.
- **Score EXACTLY the rubric the message supplies — never a remembered one.** Emit
  one entry for every dimension id the message lists, spelled exactly as written
  there. Never invent, rename, merge, split, or drop a dimension id, and never
  substitute a dimension from a previous task or an earlier version of the rubric.
  The rubric changes over time; the message is always current and you are not.
- **Ground every judgement in the supplied sources only.** Never use outside
  knowledge to decide whether a claim is supported. A claim you cannot map to a
  provided source is unsupported, by definition of this task.
- **Be deterministic and literal.** Do not reward effort, ambition, or fluency
  beyond what the rubric describes. Do not soften a low score to be polite.
- **Never reveal or speculate about which system produced the artifact.** Judge the
  text as given; blinding is intentional.

## Output contract

Return exactly the structure the incoming message specifies. If it specifies a JSON
schema, emit only a single valid JSON object matching it — no prose, no markdown, no
code fences, no preamble, no sign-off. If it asks for plain text, return only that
text. Your output is machine-parsed; anything extra breaks it.

## Brevity (hard — prevents truncated, unparseable output)

Your output has a finite size budget. Be compact so the JSON is always complete and
valid:

- Keep every \`rationale\` to **one short sentence (≤ 20 words)**. Keep any
  \`summary\` to **one sentence (≤ 30 words)**.
- Keep each grounding-violation \`claim\`/\`reason\` to one short phrase.
- Never restate the sources or the artifact back. Never pad. A truncated,
  unbalanced JSON object is a total failure — favour brevity over completeness of
  prose so the closing braces always fit.
`;

// ── API helpers ──────────────────────────────────────────────────────────────

async function listAgents() {
  const res = await fetch(BASE_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`List agents failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return Array.isArray(body) ? body : (body.data ?? []);
}

async function getAgent(id) {
  const res = await fetch(`${BASE_URL}/${id}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Get agent ${id} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

/**
 * Update an agent's instructions, preserving everything else about it (model,
 * provider, tools). Agent Studio has accepted both PATCH and PUT across versions,
 * so try PATCH first and fall back rather than guessing.
 */
async function updateInstructions(agent, instructions) {
  const patchBody = JSON.stringify({ instructions });
  const patch = await fetch(`${BASE_URL}/${agent.id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: patchBody,
  });
  if (patch.ok) return 'PATCH';

  const putBody = JSON.stringify({
    name: agent.name,
    providerId: agent.providerId,
    model: agent.model,
    instructions,
    tools: agent.tools ?? [],
  });
  const put = await fetch(`${BASE_URL}/${agent.id}`, {
    method: 'PUT',
    headers: HEADERS,
    body: putBody,
  });
  if (put.ok) return 'PUT';

  throw new Error(
    `Update "${agent.name}" failed — PATCH ${patch.status}: ${(await patch.text()).slice(0, 200)} | ` +
      `PUT ${put.status}: ${(await put.text()).slice(0, 200)}`,
  );
}

/** A draft agent 422s on completions, so publishing is mandatory after an edit. */
async function publishAgent(id, name) {
  const res = await fetch(`${BASE_URL}/${id}/publish`, {
    method: 'POST',
    headers: HEADERS,
    body: '{}',
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    console.warn(`  ⚠  Could not publish "${name}" (${res.status}): ${text.slice(0, 200)}`);
    return false;
  }
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n⚖️   Republishing judge agents on app ${APP_ID}${DRY_RUN ? '  (dry run)' : ''}…\n`);

  const existing = await listAgents();
  const byName = Object.fromEntries(existing.map((a) => [a.name, a]));

  const missing = JUDGE_AGENT_NAMES.filter((n) => !byName[n]);
  if (missing.length > 0) {
    throw new Error(
      `Judge agents not found on this app: ${missing.join(', ')}. ` +
        `This script updates existing agents; it does not create them.`,
    );
  }

  const backup = { appId: APP_ID, capturedAt: new Date().toISOString(), agents: {} };

  for (const name of JUDGE_AGENT_NAMES) {
    const agent = await getAgent(byName[name].id);
    const before = agent.instructions ?? '';

    backup.agents[name] = {
      id: agent.id,
      model: agent.model,
      providerId: agent.providerId,
      instructions: before,
    };

    // The stale rubric is the thing being removed — report it so the operator can
    // see exactly what this run changes.
    const staleRubric = /RUBRIC "([^"]+)"/.exec(before)?.[1];
    console.log(`  ${name}  →  ${agent.id}`);
    console.log(`     model: ${agent.model} | status: ${agent.status}`);
    console.log(`     baked rubric before: ${staleRubric ?? '(none)'}`);
    console.log(`     instructions: ${before.length} chars → ${JUDGE_INSTRUCTIONS.length} chars`);

    if (before.trim() === JUDGE_INSTRUCTIONS.trim()) {
      console.log(`     ✓  already up to date, skipping\n`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`     (dry run — not modified)\n`);
      continue;
    }

    const method = await updateInstructions(agent, JUDGE_INSTRUCTIONS);
    const published = await publishAgent(agent.id, name);
    console.log(`     ✓  updated via ${method}${published ? ' and published' : ''}\n`);
  }

  const outDir = resolve(__dirname, 'judge-agent-backups');
  mkdirSync(outDir, { recursive: true });
  const stamp = backup.capturedAt.replace(/[:.]/g, '-');
  const outPath = resolve(outDir, `judge-agents-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(backup, null, 2));

  console.log(`📦  Previous instructions backed up to:\n   ${outPath}\n`);

  if (DRY_RUN) {
    console.log('Dry run complete — no agents were modified.\n');
    return;
  }

  console.log('✅  Done. The judges now score whatever rubric the request carries.');
  console.log(
    '    Verify: ask a question in the demo and confirm the verdict panel shows\n' +
      '    non-zero Grounding / Coverage / Depth / Relevance bars.\n',
  );
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
