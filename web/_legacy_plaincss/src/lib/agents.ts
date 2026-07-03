/**
 * Agent + env configuration for the ACS chat panel.
 *
 * Agent IDs verified 2026-07-01 against two independent sources of truth in
 * the ACS repo (not hardcoded from guesswork): `SESSION.md` line 45 and
 * `web/docs/workspace/acs-chat-ui/02-handoff-protocol.md` line 23. Both agree.
 * If these ever drift, SESSION.md's "Agent IDs:" line is the source of truth
 * — re-verify there before changing these constants.
 */
import type { CompletionsConfig } from './agentStudio';

export const GENERIC_AGENT_ID = '13809d4b-6b6d-4297-b95c-a934bceef0b4';
export const TECHNICAL_AGENT_ID = '63ab0c86-3493-416b-a771-a820ab25d83d';

/** Sentinel token the Generic agent appends on its own final line when a
 *  question needs the Technical agent's deep-code handling. */
export const HANDOFF_SENTINEL = '[[HANDOFF:technical]]';

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

export function getGenericConfig(): CompletionsConfig {
  const { appId, searchKey } = getEnvConfig();
  return { appId, searchKey, agentId: GENERIC_AGENT_ID };
}

export function getTechnicalConfig(): CompletionsConfig {
  const { appId, searchKey } = getEnvConfig();
  return { appId, searchKey, agentId: TECHNICAL_AGENT_ID };
}
