/**
 * agentConfig — pure, static configuration for the ACS agent panel.
 * No network, no top-level await: safe to import from tests without touching
 * the live Agent Studio API. All side-effecting orchestration stays in
 * build_acs_agents.mjs, which imports these values.
 */

export const INDEX = 'ACS_SPECTRUM_MULTI';
export const CLONE_BASE = 'ACS-generic-neural'; // self-hosting; falls back below if the panel isn't built yet

// Explicit model for both personas' main completions — NOT cloned from
// whatever the live agent's own `model` field currently is. Previously
// build_acs_agents.mjs read `base.model` off the self-clone target, which
// meant a dead/deprecated model on the live agent would perpetuate itself
// forever (every refresh re-reads the same broken value). Confirmed live
// 2026-07-09 that gemini-2.5-flash-lite was deprecated by the provider
// mid-session (404 "no longer available") — every agent + the suggestions
// config were pinned to it. gemini-2.5-flash is confirmed live and working.
export const MAIN_MODEL = 'gemini-2.5-flash';

// Decision (Arijit 2026-07-01): 2 agents = Generic (all sources, front door) + Technical (React code).
// filters:null → no source filter (sees the whole 502-record corpus).
// extraTools: neither agent carries a client_side tool — the Generic→Technical
// deep-dive handoff is now driven by the platform-native config.suggestions
// mechanism (a `SPECIALIST:`-prefixed suggestion), not an agent-to-agent tool call.
export const PERSONAS = [
  { name: 'ACS-generic-neural', prompt: 'instructions_generic.md', filters: null, desc: 'ACS_SPECTRUM_MULTI — full Spectrum corpus (all sources).', extraTools: [] },
  { name: 'ACS-technical-neural', prompt: 'instructions_technical.md', filters: 'source:"ReactSpectrumS2" OR source:"ReactSpectrumV3" OR source:"ReactAria"', desc: 'ACS_SPECTRUM_MULTI scoped to React code docs (ReactSpectrumS2 + V3 + ReactAria).', extraTools: [] },
  {
    name: 'ACS-classifier-neural',
    prompt: 'instructions_classifier.md',
    filters: null,
    desc: 'ACS_SPECTRUM_MULTI classifier — no independent search, classifies from supplied context only.',
    extraTools: [],
    noSearchTool: true,
    expectSuggestions: false,
  },
];
// retire the superseded designer/developer split
export const RETIRE = ['ACS-designer-neural', 'ACS-developer-neural'];

// Dry-run mechanism: agents are looked up/created/patched under a suffixed
// name so a test run (ACS_AGENT_SUFFIX=-dev) never touches the live agents
// whose IDs the frontend hardcodes. Empty suffix → the real live names.
export function buildAgentName(baseName, suffix) {
  return `${baseName}${suffix}`;
}

// Native platform suggestions config. Fields locked by the approved spec
// (04-spec.md). A gemini-2.5-flash completion emits exactly one follow-up
// per turn, with the turn's tool outputs (retrieved hits) in context so it can
// name real content.
// MODEL NOTE (2026-07-09, same day, mid-session): gemini-2.5-flash-lite was
// deprecated by the provider WHILE this build was live — confirmed via the
// literal 404 from the completions endpoint ("This model
// models/gemini-2.5-flash-lite is no longer available"), not a local guess.
// Every agent + this suggestions config were pinned to it; all broke at once.
// Switched to gemini-2.5-flash (confirmed live 2026-07-09) — same tier
// intent (fast/cheap, not the heavier -pro), ~4x cheaper than gemini-2.5-pro
// per Google's public pricing ($0.30/$2.50 vs $1.25/$10.00 per 1M tokens
// in/out). If this ever 404s again, check the provider's model list before
// assuming a code regression — this exact failure mode already happened once.
// NOTE: generation carries ONLY max_count. `max_words` is accepted by the
// agent write-path (PATCH/GET round-trips clean) but 500s the completions
// endpoint at runtime on every call (confirmed live 2026-07-09) — the classic
// write-acceptance ≠ runtime-correctness trap. Do not re-add it.
export function buildSuggestionsConfig(systemPrompt, enabled = true) {
  return {
    enabled,
    model: 'gemini-2.5-flash',
    system_prompt: systemPrompt,
    generation: { max_count: 1 },
    context: { include_tool_outputs: true },
  };
}

// Only scopes algolia_search_index tools (indices/searchParameters) — other
// tool types (e.g. client_side) pass through build_acs_agents untouched via
// extraTools instead, so this must never touch them or it'd stamp the wrong
// description/index onto a non-search tool.
// Moved here (was a local function in build_acs_agents.mjs) so it's
// unit-testable without importing that file's unguarded top-level
// `listAgents()` network call (Task A1, testability refinement).
// noSearchTool:true (Architecture Review C2) is the escape hatch for a
// persona that must carry NO search tool at all — e.g. the classifier
// (Task A4), which classifies only from context the client embeds in its
// query, never its own retrieval.
export function scopeTools(tools, filters, desc, { noSearchTool = false } = {}) {
  if (noSearchTool) return [];
  const searchTools = tools.filter((t) => t.type === 'algolia_search_index');
  const t = JSON.parse(JSON.stringify(searchTools));
  for (const tool of t) { tool.description = desc; if (Array.isArray(tool.indices)) for (const ix of tool.indices) { ix.index = INDEX; ix.description = desc; ix.searchParameters = ix.searchParameters ?? {}; if (filters) ix.searchParameters.filters = filters; else delete ix.searchParameters.filters; } }
  return t;
}

// Single source of truth for the agent request body. Called at BOTH the PATCH
// (existing agent) and POST (new agent) sites in build_acs_agents.mjs so
// config.suggestions can never be set on one path and silently missed on the
// other. name/status are included only when provided (POST needs them; PATCH
// omits them to stay shape-compatible with the live in-place update body).
export function buildAgentBody({ name, status, instructions, model, providerId, tools, suggestionsConfig }) {
  return {
    instructions,
    model,
    providerId,
    tools,
    config: { suggestions: suggestionsConfig },
    ...(name ? { name } : {}),
    ...(status ? { status } : {}),
  };
}

// Hard gate: a persona is not "done" unless the server round-trips
// config.suggestions.enabled === true. build_acs_agents.mjs exits 1 if false.
export function assertSuggestionsEnabled(agentJson) {
  return agentJson?.config?.suggestions?.enabled === true;
}
