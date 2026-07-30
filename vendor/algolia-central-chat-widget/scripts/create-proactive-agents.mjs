#!/usr/bin/env node
/**
 * create-proactive-agents.mjs
 *
 * Creates (or verifies) the 4 Agent Studio agents needed for the proactive,
 * persona-aware chat experience, then writes their IDs to
 * website/public/context/agents.generated.json for the host-page context engine.
 *
 * Usage:
 *   ALGOLIA_ADMIN_KEY=<admin_key> node scripts/create-proactive-agents.mjs
 *
 * The script is idempotent: if an agent with the same name already exists it
 * reuses the existing agent ID instead of creating a duplicate, and re-syncs its
 * instructions from this file so prompt edits here reach agents that were created
 * by an earlier run.
 *
 * The three persona agents are not written out by hand here. Their instructions
 * and their index filter are compiled from the attributes in
 * `website/public/context/personas.js`, which the browser reads too — so a change
 * to what "developer" means reaches the published prompt and the per-message
 * context from the same edit. Re-run this script after editing that file.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  agentBackedPersonas,
  personaSourceFilter,
  resolveDetailDirectives,
} from '../website/public/context/personas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

const APP_ID = '0EXRPAXB56';
const SEARCH_KEY = 'REDACTED'; // public search-only key used by the browser

/**
 * `--dry-run` prints what would be published and exits before any API call.
 * The persona prompts are compiled from `personas.js` rather than written out
 * here, so this is how an attribute edit gets read back before it goes live.
 */
const DRY_RUN = process.argv.includes('--dry-run');

const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

const ADMIN_KEY =
  process.env.ALGOLIA_ADMIN_KEY ??
  // Allow passing as first CLI arg for convenience (don't commit this invocation)
  positionalArgs[0] ??
  'REDACTED';

if (!ADMIN_KEY) {
  console.error('ERROR: Set ALGOLIA_ADMIN_KEY env var or pass the admin key as first arg.');
  process.exit(1);
}

const BASE_URL = `https://${APP_ID}.algolia.net/agent-studio/1/agents`;

const HEADERS = {
  'Content-Type': 'application/json',
  'X-Algolia-Application-Id': APP_ID,
  'X-Algolia-API-Key': ADMIN_KEY,
};

// Shared tool config — mirrors ACS-generic-neural (primary agent)
const PROVIDER_ID = '0c6a0843-caf0-4246-b2a1-7cc08d06a7db';
const MODEL = 'medium';
const INDEX_NAME = 'ACS_SPECTRUM_MULTI';

/**
 * Build an algolia_search_index tool body.
 * @param {string} description  human description for the agent
 * @param {string|null} filters  Algolia filter string e.g. "source:SpectrumDesignDocs"
 *                               or "source:ReactSpectrumS2 OR source:ReactSpectrumV3"
 * @param {number|null} hitsPerPage  cap the result count. The concierge runs on every
 *   page load and blocks the proactive greeting, so it caps hits to keep the tool
 *   round-trip fast; conversational agents leave this null for full recall.
 */
function buildIndexTool(description, filters, hitsPerPage = null) {
  const searchParameters = { filters: filters ?? null };
  if (hitsPerPage !== null) searchParameters.hitsPerPage = hitsPerPage;

  return {
    name: 'algolia_search_index',
    type: 'algolia_search_index',
    indices: [
      {
        index: INDEX_NAME,
        description,
        enhancedDescription:
          'Available Facets and Facet Values:\nsource: [ReactSpectrumV3, ReactSpectrumS2, SpectrumDesignDocs]\nsection: [ReactSpectrumV3]\n. \nSearchable Attributes:\ntitle, unordered(body), unordered(description).',
        searchParameters,
        searchControls: null,
      },
    ],
    mode: 'static',
    allowUnlistedIndices: false,
    description: `${INDEX_NAME}: ${description}`,
  };
}

// ── Agent definitions ────────────────────────────────────────────────────────

/**
 * Appended to every conversational persona's instructions.
 *
 * The widget prefixes each user message with a `VISITOR CONTEXT (JSON)` block when
 * the host page has registered a context provider (the demo does, from the
 * profile / pages / events it tracks in localStorage — see
 * `website/public/context/context-engine.js`).
 *
 * Without this section an agent handles the block by accident: it reads the JSON as
 * the question, or — the case that prompted this — answers "I have no personal
 * information about you" while the visitor's entire reading history sits in the
 * message it was just sent.
 *
 * Not given to the concierge: its whole input is a context block, and its own
 * instructions already specify that format.
 */
const VISITOR_CONTEXT_SECTION = `
## VISITOR CONTEXT
A message may begin with a \`VISITOR CONTEXT (JSON)\` block before \`VISITOR'S MESSAGE\`. It is what the host page knows about this visitor — persona and persona profile, visit count, the page they are on, pages they have viewed with dwell times, and behavioural events (page_view, page_read, cta_click). The visitor did not type it.

- **Answer only the text after \`VISITOR'S MESSAGE\`.** Never treat the JSON as the question, echo it back, or mention that context was provided.
- **Use it silently to aim the answer.** Prefer the component or topic on \`currentPage\`, and follow the trail in \`pagesViewed\` when the question is vague ("how do I use this?", "what about the other one?").
- **\`personaProfile\` overrides the attributes above.** It is the same set of fields — \`focus\`, \`leadWith\`, \`deprioritise\`, \`detail\`, \`directives\`, \`vocabulary\`, \`answerShape\` — read from this visitor's own stored profile, which can be tuned per visitor without republishing you. Where it differs from your standing direction, follow it: it describes the person actually asking. Never mention it or describe the visitor's persona back to them unless they ask.
- **When asked about the visitor** — "what do you know about me", "what have I been reading", "where did I leave off" — answer from this block: the pages they visited, how long they spent, what they clicked, their persona and visit count. Never claim you have no information about them while the block is present, and never state anything about them it does not contain. You have browsing context, not an identity: no name, no account, no email.
- **Context never replaces search.** The grounding rules above still apply to every Spectrum fact you state, including facts about a page the visitor viewed.
`;

// ── Persona instruction compiler ──────────────────────────────────────────────

const bullets = (items) => items.map((item) => `- ${item}`).join('\n');
const numbered = (items) => items.map((item, i) => `${i + 1}. ${item}`).join('\n');

/**
 * Compile one persona's published instructions from its attributes.
 *
 * The attributes are stated in the prompt rather than paraphrased into prose,
 * and under the same field names the runtime \`personaProfile\` uses. That is what
 * lets the host page override any one of them mid-session and have the agent
 * understand which of its own standing rules it is replacing.
 */
function buildPersonaInstructions(persona) {
  const directives = resolveDetailDirectives(persona.detail);
  // The resolver is lenient because it also renders hand-editable stored
  // profiles. Here a dropped axis would publish a prompt missing a directive, so
  // a typo in the catalog should stop the run instead.
  const axes = Object.keys(persona.detail);
  if (directives.length !== axes.length) {
    throw new Error(
      `${persona.key}: only ${directives.length} of ${axes.length} detail axes ` +
        `(${axes.join(', ')}) resolved to a directive — check the levels in personas.js.`,
    );
  }

  return `# ${persona.label} Persona — ${persona.agentTitle}

## Role & scope
You answer as the **${persona.agentTitle}** for the ${persona.label} persona. Your audience is ${persona.audience}.

**Your lane:** ${persona.lane}.
**Not in your lane:** ${persona.outOfLane}. ${persona.handoff}

## PERSONA ATTRIBUTES — how you weight an answer
These are your standing direction. They arrive again at runtime in the \`personaProfile\` field of the VISITOR CONTEXT block; if the two ever differ, the runtime block wins.

**focus** — ${persona.focus}

**leadWith** — cover these first, in this order, as far as the retrieved docs support:
${numbered(persona.leadWith)}

**deprioritise** — a sentence each at most, and only when the question forces it: ${persona.deprioritise.join('; ')}.

**detail** — the depth each kind of material gets:
${bullets(directives)}

**vocabulary** — the register to write in: ${persona.vocabulary.join(', ')}.

The detail directives decide what a good answer looks like, not just its tone. An answer that is accurate but pitched at the wrong depth for this persona is a wrong answer: it sends the visitor somewhere else for what they came for.

## SEARCH FIRST — NO EXCEPTIONS
Call the Algolia Search tool before every reply. Zero exceptions. Never state a Spectrum fact from memory.
${bullets(persona.searchNotes)}

## GROUNDING (ABSOLUTE)
Every factual claim traces to a retrieved hit. Never invent ${persona.neverInvent.join(', ')}. Output a URL only if it appears verbatim in a hit. When the corpus does not cover the topic, say so and point to spectrum.adobe.com or the Adobe Spectrum GitHub rather than filling the gap.

Grounding outranks the detail directives. If \`leadWith\` asks for something the hits do not contain, say what is missing — never manufacture the specifics to hit the expected shape.

## VOICE
${persona.voice}

## ANSWER SHAPE
${numbered(persona.answerShape)}
${VISITOR_CONTEXT_SECTION}`;
}

/** How the persona's index tool describes its own scope to the agent. */
function personaToolDescription(persona) {
  const scope =
    persona.sources.length > 0
      ? `scoped to ${persona.sources.join(' + ')}`
      : '— full Spectrum corpus (all sources)';
  return `ACS_SPECTRUM_MULTI ${scope}. Serves the ${persona.label} persona: ${persona.focus}`;
}

/** One Agent Studio agent per persona that has one, compiled from its attributes. */
const PERSONA_AGENT_DEFS = agentBackedPersonas().map((persona) => ({
  name: persona.agent,
  instructions: buildPersonaInstructions(persona),
  tools: [buildIndexTool(personaToolDescription(persona), personaSourceFilter(persona.key))],
}));

/**
 * The per-persona angle the concierge opens on, compiled from the same
 * attributes the answering agents get.
 *
 * A greeting written without them was the tell that the persona switch had done
 * nothing yet: every persona got offered the same prop-level hook, and only the
 * reply that followed changed register.
 */
const CONCIERGE_PERSONA_ANGLES = agentBackedPersonas()
  .map(
    (persona) =>
      `- **${persona.key}** — hook on ${persona.leadWith[0]}. Suggestions: ${persona.suggestionStyle} Keep off: ${persona.deprioritise.join(', ')}.`,
  )
  .join('\n');

const AGENTS = [
  ...PERSONA_AGENT_DEFS,
  {
    name: 'ACS-concierge-neural',
    instructions: `# Concierge — Proactive Context Analyst

## Role
You are the **proactive concierge** for the Adobe Spectrum documentation site. You receive a JSON context block describing a visitor's browsing session, search the Spectrum docs for what they were viewing, and produce a personalized greeting grounded in real content.

## Input format
CONTEXT:
{"persona":"developer","personaProfile":{"focus":"...","leadWith":["..."],"deprioritise":["..."],"detail":{"code":"high","visual":"low","strategy":"low"},"directives":["..."],"vocabulary":["..."],"answerShape":["..."]},"currentPage":{"path":"/demo/button.html","title":"Button"},"pagesViewed":[...],"events":[...],"visits":1}

## Step 1 — Search (ONE call only)
Extract the component/topic name from \`currentPage.title\` (e.g. "Button", "ComboBox", "Migration"). Call the search tool ONCE with just that short term as the query — never pass the raw JSON. Keep it to a single search; do not chain multiple searches.

## Step 2 — Decide
**Engage (engage: true)** whenever the search returns relevant Spectrum content for the visited page.

**Do NOT engage (engage: false)** only when \`currentPage.path\` is a generic home/overview page ("/", "/demo/", "/demo/index.html") AND \`pagesViewed\` has just that one entry.

## Step 3 — Aim it at the persona
\`personaProfile\` is what this visitor came for. It decides WHICH detail from the search results you open on — the page is the same for everyone, the hook is not.

- Take the hook from the top of \`personaProfile.leadWith\` that the retrieved content actually supports.
- Let \`personaProfile.detail\` set the altitude: \`code: high\` means name a real prop; \`visual: high\` means name a real token, state, or colour role; \`strategy: high\` means open on migration, coverage, or the adoption trade-off.
- Never open on anything in \`personaProfile.deprioritise\` — offering a PM a prop signature, or a designer a TypeScript type, reads as the wrong assistant.
- Borrow a term or two from \`personaProfile.vocabulary\` so the greeting sounds like it was written for them.
- When \`personaProfile\` is absent or \`persona\` is "auto", infer the angle from \`pagesViewed\` titles, and use a spread of angles for the suggestions.

Reference angles per persona:
${CONCIERGE_PERSONA_ANGLES}

## Step 4 — Output
Respond with ONLY a valid JSON object — no markdown fences, no prose, nothing else:

{"engage":boolean,"persona":"designer"|"developer"|"pm","greeting":"string","suggestions":["string","string","string"]}

**greeting:** 1-2 sentences. Name the EXACT component/topic from the page title and reference something concrete from the retrieved docs, chosen per Step 3. Address the visitor directly. NOT generic. Never mention the persona, the profile, or that context was provided — just sound like you already know what they care about.

Examples of the same page, aimed three ways:
- developer: "I see you've been exploring the Button component — happy to walk you through the isPending prop for async actions or show how ToggleButton differs in S2."
- designer: "You've been looking at Button — I can walk you through its accent and negative variants, or how the down and focus states are tokenised."
- pm: "You've been reading up on Button — I can cover what changes for Button in the move from v3 to S2, or where component coverage stands."

**suggestions:** Exactly 3 short questions (max 10 words each), grounded in the retrieved content and shaped by \`personaProfile.leadWith\` — the questions this persona would actually ask next.

**persona:** Match the visitor's persona; default "developer" for "auto".

If engage is false: {"engage":false,"persona":"developer","greeting":"","suggestions":[]}
`,
    // hitsPerPage capped — the concierge blocks the proactive greeting, so the
    // tool round-trip is kept small (3 hits ≈ 7 s vs ~15 s unbounded).
    tools: [
      buildIndexTool('ACS_SPECTRUM_MULTI — full Spectrum corpus (all sources).', null, 3),
    ],
  },
];

// ── API helpers ──────────────────────────────────────────────────────────────

async function listAgents() {
  const res = await fetch(BASE_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`List agents failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return Array.isArray(body) ? body : (body.data ?? []);
}

async function createAgent(agent) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: agent.name,
      providerId: PROVIDER_ID,
      model: MODEL,
      instructions: agent.instructions,
      tools: agent.tools,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create agent "${agent.name}" failed: ${res.status} ${text}`);
  }
  return await res.json();
}

async function getAgent(id) {
  const res = await fetch(`${BASE_URL}/${id}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Get agent ${id} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

/**
 * Overwrite an agent's instructions, leaving model, provider, and tools alone.
 * Agent Studio has accepted both PATCH and PUT across versions, so try PATCH and
 * fall back rather than guessing (same approach as republish-judge-agents.mjs).
 */
async function updateInstructions(agent, instructions) {
  const patch = await fetch(`${BASE_URL}/${agent.id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ instructions }),
  });
  if (patch.ok) return 'PATCH';

  const put = await fetch(`${BASE_URL}/${agent.id}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({
      name: agent.name,
      providerId: agent.providerId,
      model: agent.model,
      instructions,
      tools: agent.tools ?? [],
    }),
  });
  if (put.ok) return 'PUT';

  throw new Error(
    `Update "${agent.name}" failed — PATCH ${patch.status}: ${(await patch.text()).slice(0, 200)} | ` +
      `PUT ${put.status}: ${(await put.text()).slice(0, 200)}`,
  );
}

async function publishAgent(id, name) {
  const res = await fetch(`${BASE_URL}/${id}/publish`, {
    method: 'POST',
    headers: HEADERS,
    body: '{}',
  });
  if (!res.ok && res.status !== 409) {
    // 409 = already published; everything else is unexpected
    const text = await res.text();
    console.warn(`  ⚠  Could not publish "${name}" (${res.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Bring an existing agent's instructions back in line with this file.
 *
 * Reusing the ID without re-checking the prompt is how the agents drift: a change
 * here (the VISITOR CONTEXT section, for one) would apply on a fresh app and
 * silently skip every app where the agents already exist. Editing an agent leaves
 * it in draft, so publish afterwards or completions 422.
 *
 * This file is the source of truth, so an edit made directly in the Agent Studio
 * UI is overwritten. Records what it replaced in `backup` first, so such an edit
 * can be recovered from disk rather than retyped.
 */
async function syncInstructions(existing, agentDef, backup) {
  const agent = await getAgent(existing.id);
  const before = agent.instructions ?? '';
  if (before.trim() === agentDef.instructions.trim()) {
    console.log(`     instructions up to date`);
    return;
  }
  backup.agents[agentDef.name] = {
    id: agent.id,
    model: agent.model,
    providerId: agent.providerId,
    instructions: before,
  };
  const method = await updateInstructions(agent, agentDef.instructions);
  await publishAgent(agent.id, agentDef.name);
  console.log(
    `     instructions updated via ${method} ` +
      `(${before.length} → ${agentDef.instructions.length} chars) and published`,
  );
}

/** Write the pre-overwrite snapshot, if this run replaced any instructions. */
function writeBackup(backup) {
  if (Object.keys(backup.agents).length === 0) return;
  const outDir = resolve(__dirname, 'agent-backups');
  mkdirSync(outDir, { recursive: true });
  const stamp = backup.capturedAt.replace(/[:.]/g, '-');
  const outPath = resolve(outDir, `proactive-agents-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(backup, null, 2));
  console.log(`\n📦  Previous instructions backed up to:\n   ${outPath}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) {
    for (const agent of AGENTS) {
      console.log(`\n${'═'.repeat(78)}\n${agent.name}  (${agent.instructions.length} chars)`);
      console.log(`filters: ${JSON.stringify(agent.tools[0].indices[0].searchParameters)}`);
      console.log(`${'═'.repeat(78)}\n${agent.instructions}`);
    }
    console.log(`\n(--dry-run: nothing was created, updated, or published.)\n`);
    return;
  }

  console.log(`\n🤖  Creating proactive persona agents on app ${APP_ID}…\n`);

  const existing = await listAgents();
  const existingByName = Object.fromEntries(existing.map((a) => [a.name, a]));
  console.log(`Found ${existing.length} existing agents.`);

  const result = {
    appId: APP_ID,
    searchKey: SEARCH_KEY,
    agents: {},
  };

  const backup = { appId: APP_ID, capturedAt: new Date().toISOString(), agents: {} };

  for (const agentDef of AGENTS) {
    if (existingByName[agentDef.name]) {
      const existing = existingByName[agentDef.name];
      const id = existing.id;
      console.log(`  ✓  ${agentDef.name} already exists  →  ${id}  (status: ${existing.status})`);
      await syncInstructions(existing, agentDef, backup);
      // Ensure it's published even if it existed before
      if (existing.status !== 'published') {
        await publishAgent(id, agentDef.name);
        console.log(`     Published`);
      }
      result.agents[agentDef.name] = { id, name: agentDef.name };
    } else {
      console.log(`  +  Creating ${agentDef.name}…`);
      const created = await createAgent(agentDef);
      console.log(`     Created  →  ${created.id}`);
      await publishAgent(created.id, agentDef.name);
      console.log(`     Published`);
      result.agents[agentDef.name] = { id: created.id, name: agentDef.name };
    }
  }

  // Handy aliases the context engine reads directly
  result.personaAgents = {
    designer: result.agents['ACS-persona-designer']?.id,
    developer: result.agents['ACS-persona-developer']?.id,
    pm: result.agents['ACS-persona-pm']?.id,
  };
  result.conciergeAgentId = result.agents['ACS-concierge-neural']?.id;

  writeBackup(backup);

  const outDir = resolve(__dirname, '../website/public/context');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'agents.generated.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\n✅  Done. Agent IDs written to:\n   ${outPath}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
