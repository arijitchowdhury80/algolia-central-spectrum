/**
 * Env + agent-config plumbing for the chat panel.
 *
 * Ported from _legacy_plaincss/src/lib/agents.ts, with one change: the two
 * agent IDs are no longer hardcoded here — they now live in the active
 * instance's config (src/config/instances/spectrum.ts), read via
 * `activeInstance.agents.generic.id` / `.technical.id` in useChat.ts. That's
 * what makes this file (and the client it configures) instance-agnostic, per
 * the templatizing goal (Task C).
 */
import type { CompletionsConfig } from './agentStudio';

/** Name of the client-side tool Generic calls to hand a question to the
 *  Technical specialist (replaces the old `[[HANDOFF:technical]]` text
 *  sentinel — see docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md). */
export const HANDOFF_TOOL_NAME = 'consult_technical_specialist';

interface EnvConfig {
  appId: string;
  searchKey: string;
}

let cachedEnv: EnvConfig | undefined;

/**
 * Read + validate the two required browser-shippable env vars. Throws a
 * clear, actionable error at first use if either is missing — never fails
 * silently into a broken fetch.
 */
export function getEnvConfig(): EnvConfig {
  if (cachedEnv) return cachedEnv;
  const appId = import.meta.env.VITE_ALGOLIA_APP_ID;
  const searchKey = import.meta.env.VITE_ALGOLIA_SEARCH_API_KEY;
  if (!appId || !searchKey) {
    throw new Error(
      'Missing Algolia env config: VITE_ALGOLIA_APP_ID and VITE_ALGOLIA_SEARCH_API_KEY ' +
        'must both be set (see web/.env.local.example). Copy it to .env.local and fill in ' +
        'a browser-safe SEARCH-ONLY key — never the admin key.',
    );
  }
  cachedEnv = { appId, searchKey };
  return cachedEnv;
}

/** Build a CompletionsConfig for a given agent ID (sourced from the active
 *  instance's config, not hardcoded). */
export function getAgentConfig(agentId: string): CompletionsConfig {
  const { appId, searchKey } = getEnvConfig();
  return { appId, searchKey, agentId };
}
