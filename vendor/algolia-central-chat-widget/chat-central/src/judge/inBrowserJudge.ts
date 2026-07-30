/**
 * inBrowserJudge — score one assistant answer by running the confidence engine
 * IN THE BROWSER against an Algolia Agent Studio backend agent
 * (mode=algolia). This is the alternative to the hosted VPS judge
 * (hostedJudgeClient.judgeAnswer): same rubric, same 3 blind judges, same grounding
 * hard-gate — but no separate judge server and no `x-lab-key`, only the
 * search-only Algolia key the chat already uses.
 *
 * Flow: hits → sources → Artifact → judgeArtifact (ONE round, 3 blind judges,
 * authorRationale=false) → aggregateRounds (consensus + voted grounding gate)
 * → JudgeVerdict (the shape ConfidenceBadge/JudgeDrawer already consume).
 */
import {
  judgeArtifact,
  aggregateRounds,
  DEFAULT_JUDGE_CONFIG,
  DEFAULT_GATE_VOTE_THRESHOLD,
  type Artifact,
  type Judgment,
  type LlmComplete,
  type Temperament,
} from './engine';
import { activeInstance } from '../config/active';
import { getRuntimeEnv } from '../config/runtime';
import { getAgentConfig } from '../shared/agents';
import { makeAgentStudioLlm } from './agentStudioLlmAdapter';
import { mapHitsToJudgeSources } from './hostedJudgeClient';
import type {
  JudgeAgentDescriptor,
  JudgeAnswerInput,
  JudgeFlaggedClaim,
  JudgePerJudge,
  JudgeVerdict,
} from './types';

/** Resolve the judge-backend agent id: explicit env override wins, else the
 *  active instance's configured `judgeBackend` agent. Undefined = not wired. */
export function judgeAgentId(): string | undefined {
  const override = getRuntimeEnv()?.judgeAgentId ?? import.meta.env?.VITE_JUDGE_AGENT_ID;
  if (override && override.trim()) return override.trim();
  return activeInstance.judgeBackend?.id;
}

/** The engine's blind-judge temperaments — the roles an agent can be pinned to. */
const JUDGE_TEMPERAMENTS: readonly Temperament[] = ['skeptic', 'referee', 'advocate'];

/** Map a free-form `role` string to a known judge temperament, or undefined. */
function normalizeTemperament(role?: string): Temperament | undefined {
  const r = role?.trim().toLowerCase();
  if (!r) return undefined;
  return (JUDGE_TEMPERAMENTS as readonly string[]).includes(r) ? (r as Temperament) : undefined;
}

/**
 * The default judge agent id used for the synthesizer and for any temperament
 * without its own dedicated agent: the first role-less agent, else the
 * env/instance judge backend, else the first configured agent overall.
 * Undefined only when nothing is wired anywhere.
 */
function pickDefaultAgentId(agents?: readonly JudgeAgentDescriptor[]): string | undefined {
  const roleLess = agents?.find((a) => !a.role?.trim());
  return roleLess?.id ?? judgeAgentId() ?? agents?.[0]?.id;
}

/**
 * Build the per-temperament LLM map, pinning each role-tagged agent to its
 * judge. Returns undefined when no agent names a recognised temperament (so the
 * common single-agent setup passes no override and every judge uses the default).
 */
function buildLlmByTemperament(
  agents: readonly JudgeAgentDescriptor[],
  llmFor: (id: string) => LlmComplete,
): Partial<Record<Temperament, LlmComplete>> | undefined {
  const map: Partial<Record<Temperament, LlmComplete>> = {};
  for (const a of agents) {
    const t = normalizeTemperament(a.role);
    const id = a.id?.trim();
    if (t && id) map[t] = llmFor(id);
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

/** Build the engine Artifact from a displayed answer + its retrieved hits. */
function buildArtifact(input: JudgeAnswerInput): Artifact {
  const sources = mapHitsToJudgeSources(input.hits).map((s, i) => ({
    id: s.id || `S${i + 1}`,
    text: s.text?.trim() || s.title?.trim() || '',
    ...(s.title ? { label: s.title } : s.url ? { label: s.url } : {}),
  }));

  return {
    type: 'algolia-answer',
    prompt: input.question,
    content: input.answer,
    sources,
    ...(input.isRefusalTest ? { expectedBehavior: 'refuse' as const } : {}),
  };
}

/** The gating Skeptic's contradicted violations, deduped by claim, highest-certainty first. */
function flaggedFromJudgments(judgments: readonly Judgment[]): JudgeFlaggedClaim[] {
  const seen = new Map<string, JudgeFlaggedClaim>();
  for (const j of judgments) {
    if (j.temperament !== 'skeptic') continue;
    for (const v of j.groundingViolations) {
      if (v.kind === 'unverifiable') continue;
      const key = v.claim.trim().toLowerCase().slice(0, 100);
      const prev = seen.get(key);
      if (!prev || v.certainty > (prev.certainty ?? 0)) {
        seen.set(key, { claim: v.claim, reason: v.reason, certainty: v.certainty });
      }
    }
  }
  return [...seen.values()].sort((a, b) => (b.certainty ?? 0) - (a.certainty ?? 0));
}

function errorVerdict(panelId: string, message: string): JudgeVerdict {
  return {
    panelId,
    dims: { grounding: 0, coverage: 0, depth: 0, relevance: 0 },
    synthesizedScore: 0,
    composite: 0,
    preGateScore: 0,
    gateTripped: false,
    borderline: false,
    flaggedClaims: [],
    perJudge: [],
    rationale: '',
    error: message,
    errorKind: 'server',
  };
}

function buildPerJudge(
  aggregate: ReturnType<typeof aggregateRounds>,
  judgments: readonly Judgment[],
): JudgePerJudge[] {
  const summaryByTemperament = new Map(judgments.map((j) => [j.temperament, j.summary]));
  return aggregate.judgeComposites.map((c) => ({
    role: c.temperament,
    score: c.composite,
    note: summaryByTemperament.get(c.temperament) ?? '',
  }));
}

interface VerdictParts {
  aggregate: ReturnType<typeof aggregateRounds>;
  perJudge: JudgePerJudge[];
  rationale: string;
  flaggedClaims: JudgeFlaggedClaim[];
}

function buildVerdictFromAggregate(panelId: string, parts: VerdictParts): JudgeVerdict {
  const { aggregate, perJudge, rationale, flaggedClaims } = parts;
  const m = aggregate.dimensionMeans;
  return {
    panelId,
    dims: {
      grounding: m.grounding ?? 0,
      coverage: m.coverage ?? 0,
      depth: m.depth ?? 0,
      relevance: m.relevance ?? 0,
    },
    synthesizedScore: aggregate.finalScore,
    composite: aggregate.finalScore,
    preGateScore: aggregate.meanPreGateScore,
    gateTripped: aggregate.gateTripped,
    borderline: aggregate.borderline,
    flaggedClaims,
    perJudge,
    rationale,
  };
}

interface ResolvedLlms {
  defaultLlm: LlmComplete;
  llmByTemperament: Partial<Record<Temperament, LlmComplete>> | undefined;
}

/**
 * Resolve the LLM seams for a judging run: builds one cached adapter per
 * unique agent id (so a temperament that reuses the default agent doesn't
 * create a duplicate), picks the default LLM, and builds the per-temperament
 * routing map when role-tagged agents are configured.
 *
 * Caller guarantees: either `llmOverride` is supplied OR `defaultAgentId` is
 * non-undefined (the `!llmOverride && !defaultAgentId` guard in the caller
 * ensures this before we reach here).
 */
function resolveJudgeLlms(
  defaultAgentId: string | undefined,
  agents: readonly JudgeAgentDescriptor[] | undefined,
  llmOverride?: LlmComplete,
): ResolvedLlms {
  const llmById = new Map<string, LlmComplete>();
  const llmFor = (id: string): LlmComplete => {
    let cached = llmById.get(id);
    if (!cached) {
      cached = makeAgentStudioLlm(getAgentConfig(id));
      llmById.set(id, cached);
    }
    return cached;
  };

  const defaultLlm = llmOverride ?? llmFor(defaultAgentId!);
  // Pin each role-tagged agent to its temperament. Skipped when a test
  // llmOverride is supplied — that single seam drives every judge.
  const llmByTemperament = llmOverride ?? !agents ? undefined : buildLlmByTemperament(agents, llmFor);
  return { defaultLlm, llmByTemperament };
}

/**
 * Judge one answer via the Algolia agent backend. Always resolves — a missing
 * agent id, a network failure, or an unparseable judge output all become an
 * error verdict rather than a thrown exception, so the chat UI never breaks.
 *
 * Multi-model judging: each configured agent whose `role` names a temperament
 * (`skeptic` / `referee` / `advocate`) drives ONLY that judge; every other
 * judge (and the Chief Synthesizer) uses the default agent (see
 * pickDefaultAgentId). A single role-less agent therefore still powers all
 * three judges exactly as before.
 *
 * @param agents  Judge agents from the chatConfidence widget (via
 *   hostedJudgeClient → judgeAnswer). When omitted, resolution falls back to
 *   getRuntimeEnv() / activeInstance.
 * @param llmOverride  Test seam: when supplied it drives ALL judges and the
 *   synthesizer, bypassing agent resolution entirely.
 */
export async function judgeAnswerViaInBrowser(
  input: JudgeAnswerInput,
  agents?: readonly JudgeAgentDescriptor[],
  llmOverride?: LlmComplete,
): Promise<JudgeVerdict> {
  const panelId = input.panelId ?? 'main';
  const defaultAgentId = pickDefaultAgentId(agents);

  if (!llmOverride && !defaultAgentId) {
    return errorVerdict(panelId, activeInstance.strings.judge.noBackendMessage);
  }

  try {
    const { defaultLlm, llmByTemperament } = resolveJudgeLlms(defaultAgentId, agents, llmOverride);
    const cfg = DEFAULT_JUDGE_CONFIG;

    const panel = await judgeArtifact(buildArtifact(input), cfg, defaultLlm, {
      round: 1,
      authorRationale: false,
      llmByTemperament,
    });
    const aggregate = aggregateRounds([panel.judgments], {
      rubric: cfg.rubric,
      synthesisCfg: cfg.synthesis,
      gateCfg: cfg.gate,
      tripThreshold: cfg.roundVoteThreshold ?? DEFAULT_GATE_VOTE_THRESHOLD,
    });

    const perJudge = buildPerJudge(aggregate, panel.judgments);
    return buildVerdictFromAggregate(panelId, {
      aggregate,
      perJudge,
      rationale: panel.synthesis.rationale,
      flaggedClaims: flaggedFromJudgments(panel.judgments),
    });
  } catch (err) {
    return errorVerdict(panelId, err instanceof Error ? err.message : String(err));
  }
}
