/**
 * agentConfig — pure, static configuration for the ACS agent panel.
 * No network, no top-level await: safe to import from tests without touching
 * the live Agent Studio API. All side-effecting orchestration stays in
 * build_acs_agents.mjs, which imports these values.
 */

export const INDEX = 'ACS_SPECTRUM_MULTI';
export const CLONE_BASE = 'ACS-generic-neural'; // self-hosting; falls back below if the panel isn't built yet

// Decision (Arijit 2026-07-01): 2 agents = Generic (all sources, front door) + Technical (React code).
// filters:null → no source filter (sees the whole 502-record corpus).
// extraTools: neither agent carries a client_side tool — the Generic→Technical
// deep-dive handoff is now driven by the platform-native config.suggestions
// mechanism (a `SPECIALIST:`-prefixed suggestion), not an agent-to-agent tool call.
export const PERSONAS = [
  { name: 'ACS-generic-neural', prompt: 'instructions_generic.md', filters: null, desc: 'ACS_SPECTRUM_MULTI — full Spectrum corpus (all sources).', extraTools: [] },
  { name: 'ACS-technical-neural', prompt: 'instructions_technical.md', filters: 'source:"ReactSpectrumS2" OR source:"ReactSpectrumV3" OR source:"ReactAria"', desc: 'ACS_SPECTRUM_MULTI scoped to React code docs (ReactSpectrumS2 + V3 + ReactAria).', extraTools: [] },
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
// (04-spec.md). A gemini-2.5-flash-lite completion emits exactly one follow-up
// per turn, with the turn's tool outputs (retrieved hits) in context so it can
// name real content.
// NOTE: generation carries ONLY max_count. `max_words` is accepted by the
// agent write-path (PATCH/GET round-trips clean) but 500s the completions
// endpoint at runtime on every call (confirmed live 2026-07-09) — the classic
// write-acceptance ≠ runtime-correctness trap. Do not re-add it.
export function buildSuggestionsConfig(systemPrompt) {
  return {
    enabled: true,
    model: 'gemini-2.5-flash-lite',
    system_prompt: systemPrompt,
    generation: { max_count: 1 },
    context: { include_tool_outputs: true },
  };
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
