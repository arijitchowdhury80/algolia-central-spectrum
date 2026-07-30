/**
 * provider — resolves which LLM the ACS judge service uses.
 *
 * ADAPTED from AC2 lab/server/src/provider.ts. AC2's version is entangled with
 * Agent Studio panel wiring (agentModel/agentProviderId/PinnedAgentSpec, an
 * OpenAI-preferred health-probe fallback tied to AC2's specific dead-OpenAI-key
 * history) that has nothing to do with running the judge standalone in ACS.
 * Simplified per the ACS judge-service spec: default provider is the Algolia
 * enablers INFERENCE server, with OpenAI (OPENAI_API_KEY) selectable via env —
 * no runtime health probe, no Agent Studio provider ids.
 *
 * Override with JUDGE_PROVIDER=openai|inference (falls back to LLM_PROVIDER for
 * parity with AC2's env-var naming, then defaults to "inference").
 */

export type Provider = "openai" | "inference";

export interface ProviderSpec {
  readonly provider: Provider;
  /** Model the judge uses for the authoritative (non-fastLive) path. */
  readonly judgeModel: string;
  /** Env var name holding the judge API key for this provider. */
  readonly keyVar: string;
  /**
   * OpenAI-compatible API base for this provider (ends in `/v1`). Only set for
   * the `inference` provider (the Algolia enablers inference server); undefined
   * for the native openai provider, which uses its SDK default host.
   */
  readonly baseURL?: string;
}

/**
 * Fixed specs per provider. Models are overridable via JUDGE_MODEL; the
 * openai default below matches AC2's validated default (gpt-5) so the ported
 * judge behaves identically absent an override.
 */
export function providerSpecs(
  env: Record<string, string | undefined> = process.env,
): Record<Provider, ProviderSpec> {
  return {
    openai: {
      provider: "openai",
      judgeModel: env.JUDGE_MODEL || "gpt-5",
      keyVar: "OPENAI_API_KEY",
    },
    // Algolia enablers inference server — OpenAI-compatible, so it rides the
    // OpenAI client with a baseURL override. Auth is a Vault-minted OIDC JWT in
    // ALGOLIA_INFERENCE_API_KEY (expires ~30d — re-mint + refresh on rotation).
    inference: {
      provider: "inference",
      judgeModel: env.JUDGE_MODEL || "medium",
      keyVar: "ALGOLIA_INFERENCE_API_KEY",
      baseURL: env.ALGOLIA_INFERENCE_BASE_URL || "https://inference.api.enablers.algolia.net/v1",
    },
  };
}

export interface ResolveOptions {
  /** Manual override: force a provider. */
  readonly force?: Provider | undefined;
}

/**
 * Resolve the active provider for the judge. INFERENCE is the default; pin
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
  if (forced === "openai" || forced === "inference") {
    return specs[forced];
  }
  return specs.inference;
}
