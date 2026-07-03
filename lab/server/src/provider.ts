/**
 * provider — resolves which LLM the ACS judge service uses.
 *
 * ADAPTED from AC2 lab/server/src/provider.ts. AC2's version is entangled with
 * Agent Studio panel wiring (agentModel/agentProviderId/PinnedAgentSpec, an
 * OpenAI-preferred health-probe fallback tied to AC2's specific dead-OpenAI-key
 * history) that has nothing to do with running the judge standalone in ACS.
 * Simplified per the ACS judge-service spec: default provider is GEMINI
 * (GOOGLE_API_KEY), with OpenAI (OPENAI_API_KEY) selectable via env — no
 * runtime health probe, no Agent Studio provider ids.
 *
 * Override with JUDGE_PROVIDER=openai|gemini (falls back to LLM_PROVIDER for
 * parity with AC2's env-var naming, then defaults to "gemini").
 */

export type Provider = "openai" | "gemini";

export interface ProviderSpec {
  readonly provider: Provider;
  /** Model the judge uses for the authoritative (non-fastLive) path. */
  readonly judgeModel: string;
  /** Env var name holding the judge API key for this provider. */
  readonly keyVar: string;
}

/**
 * Fixed specs per provider. Models are overridable via JUDGE_MODEL; the
 * per-provider defaults below match AC2's validated defaults (gemini-2.5-pro /
 * gpt-5) so the ported judge behaves identically absent an override.
 */
export function providerSpecs(
  env: Record<string, string | undefined> = process.env,
): Record<Provider, ProviderSpec> {
  return {
    gemini: {
      provider: "gemini",
      judgeModel: env.JUDGE_MODEL || "gemini-2.5-pro",
      keyVar: "GOOGLE_API_KEY",
    },
    openai: {
      provider: "openai",
      judgeModel: env.JUDGE_MODEL || "gpt-5",
      keyVar: "OPENAI_API_KEY",
    },
  };
}

export interface ResolveOptions {
  /** Manual override: force a provider. */
  readonly force?: Provider | undefined;
}

/**
 * Resolve the active provider for the judge. GEMINI is the default; pin
 * OPENAI via JUDGE_PROVIDER=openai (or LLM_PROVIDER=openai for AC2 parity).
 */
export function resolveActiveProvider(
  env: Record<string, string | undefined>,
  opts: ResolveOptions = {},
): ProviderSpec {
  const specs = providerSpecs(env);
  const forced =
    opts.force ??
    (env.JUDGE_PROVIDER as Provider | undefined) ??
    (env.LLM_PROVIDER as Provider | undefined);
  if (forced === "openai" || forced === "gemini") {
    return specs[forced];
  }
  return specs.gemini;
}
