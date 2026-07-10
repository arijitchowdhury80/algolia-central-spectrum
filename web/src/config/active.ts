/**
 * The active instance for this build of the app, plus its skin. This is the
 * ONE file that wires a concrete instance + theme together — swapping to a
 * different `Algolia-Central-[Company]` instance means changing the two
 * lines below (or, per Part 2, generating this file via new-instance.mjs).
 */
import type { InstanceConfig } from './instance';
import spectrumInstance from './instances/spectrum';
// Algolia × Adobe cobrand: Algolia design language (Sora, Nebula Blue, Algolia
// tokens) over the Adobe Spectrum corpus/brand. See themes/algolia-adobe.css.
import '../themes/algolia-adobe.css';

/**
 * Dev/live agent-ID override (Architecture Review I2, Task A3). Deliberately
 * a pure function — the env read (`import.meta.env.VITE_ACS_DEV_AGENT_IDS`)
 * happens at the module-level call site below, NOT inside this function, so
 * the merge logic itself is testable without mocking Vite's env object (this
 * codebase has no existing precedent for that — see 05-plan.md Task A3's
 * testability refinement over the reviewed design).
 *
 * Unset → today's behavior unchanged. Malformed JSON → loud console error,
 * falls back to live. Only keys already present on `instance.agents` get
 * overridden, so an override targeting a not-yet-existing key (e.g.
 * `classifier` before Task A4 lands) is a silent no-op by construction — this
 * is what lets this override ship in Wave 0 before the classifier agent key
 * exists: once A4 lands, the exact same override code starts working for
 * `classifier` with zero further changes here.
 */
export function withDevAgentOverrides(
  instance: InstanceConfig,
  rawOverrides: string | undefined,
): InstanceConfig {
  if (!rawOverrides) return instance;
  let overrides: Record<string, string>;
  try {
    overrides = JSON.parse(rawOverrides);
  } catch {
    console.error('[active] VITE_ACS_DEV_AGENT_IDS is set but not valid JSON — ignoring, using live agent IDs.');
    return instance;
  }
  const agents = { ...instance.agents } as Record<string, InstanceConfig['agents']['generic']>;
  for (const [key, devId] of Object.entries(overrides)) {
    if (agents[key] && devId) agents[key] = { ...agents[key], id: devId };
  }
  console.warn(`[active] DEV AGENT ID OVERRIDE ACTIVE for: ${Object.keys(overrides).join(', ')} — this build is NOT using live agent IDs.`);
  return { ...instance, agents: agents as InstanceConfig['agents'] };
}

export const activeInstance = withDevAgentOverrides(spectrumInstance, import.meta.env.VITE_ACS_DEV_AGENT_IDS);
