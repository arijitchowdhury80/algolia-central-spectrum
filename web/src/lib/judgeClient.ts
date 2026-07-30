/**
 * judgeClient — talks to the local `lab/server` judge HTTP service
 * (`POST /api/judge`, `npm run judge:serve`, default port 8788) to grade an
 * assistant answer for Usefulness (1-10) under a grounding corroboration gate
 * (Phase 2 rebuild).
 *
 * Wire contract (Read Receipt — lab/judge/README.md §4b "HTTP service",
 * lines 181-232):
 *   POST /api/judge  { question, panels:[{panelId, label?, answer,
 *     sources:[{id,title?,url?,text}]}], isRefusalTest?, rounds }
 *   -> LiveJudgeResult { rounds, panels:[{panelId, dims:{usefulness},
 *     synthesizedScore, composite, preGateScore, gateTripped, borderline,
 *     corroboratedClusters, soloFlags,
 *     flaggedClaims:[{claim,reason,certainty,judgeIds,sourceId?,excerpt?,excerptVerified?}],
 *     perJudge:[{role,score,note}], rationale, error?}] }
 * `Source.text` is what grounding is scored against — it must be the
 * record's real body, not just its title (README §5).
 *
 * Live judging is indicative (1 round, fast model) — see useJudge.ts.
 * This client NEVER throws into render: any network/HTTP/parse failure
 * resolves to an error verdict (`error` set, all scores 0) instead.
 *
 * DEPLOY REALITY (corrected 2026-07-19): the note that used to sit here
 * claiming "version skew against the deployed ac2-lab-backend" was a
 * cross-project mixup. `ac2-lab-backend` / judge.contentengagement.info is
 * AC2's own, separately deployed judge service — it has never been ACS's
 * judge and this repo's pushes never touch it. ACS's own judge
 * (`lab/server` here) has NEVER been deployed anywhere; VITE_JUDGE_URL
 * defaults to `http://localhost:8788` and every verdict rendered so far came
 * from a locally-run judge. The `acs-lab-backend` deploy pipeline exists but
 * is not yet activated.
 */

export type JudgeRole = 'skeptic' | 'referee' | 'advocate';

/** Per-dimension mean scores (0–10), keyed by the backend's dimension ids.
 *  This repo's own judge source (`lab/judge/src/rubric.ts`, `lab/server/src/
 *  judge/liveJudge.ts`) implements a SINGLE-dimension rubric — `usefulness`
 *  (Phase 2 rebuild; the old grounding/coverage/depth/relevance 4-dim model
 *  is retired — grounding is now purely the corroboration gate, not a scored
 *  number). Kept loose (Record) so a stale/older judge response (pre-Phase-2
 *  fixture replay, or any future rubric change) still renders instead of
 *  crashing on a missing key. */
export type JudgeDims = Record<string, number>;

export interface JudgeDimension {
  id: string;
  label: string;
  score: number;
}

/**
 * A claim flagged as unsupported by the sources. Phase 2 rebuild: ANY judge
 * can flag (not just the Skeptic) — what caps the score is corroboration
 * (`judgeIds.length >= 2`), surfaced here so the UI can show WHO flagged it,
 * not just that someone did. Carries the traceable-excerpt fields (spec §1c):
 * `sourceId`/`excerpt` point at the exact source text that contradicts the
 * claim, and `excerptVerified` (set by a deterministic post-validator, never
 * the LLM) confirms the excerpt is actually a verbatim substring of that
 * source. The live backend names the 0–1 score `confidence`; older/batch
 * shapes use `certainty`. Read whichever is present (see JudgeDrawer).
 */
export interface JudgeFlaggedClaim {
  claim: string;
  reason: string;
  certainty?: number;
  confidence?: number;
  /** Distinct judges that flagged this claim's cluster (>= 2 = corroborated/capping). */
  judgeIds?: string[];
  /** Id of the source whose text contradicts the claim; "" for pure fabrication. */
  sourceId?: string;
  /** Verbatim excerpt from that source doing the contradicting. */
  excerpt?: string;
  /** True iff `excerpt` was verified to actually appear (verbatim, normalized-whitespace) in `sourceId`'s text. */
  excerptVerified?: boolean;
}

/** One gate-eligible claim cluster — a claim clustered across judges by
 *  similarity, kept alongside the flattened `flaggedClaims` list so the UI
 *  can render "N judges agree" grouping when it wants to. */
export interface JudgeCluster {
  representativeClaim: string;
  judgeIds: string[];
  maxCertainty: number;
  violations: {
    claim: string;
    reason: string;
    certainty: number;
    sourceId?: string;
    excerpt?: string;
    excerptVerified?: boolean;
  }[];
}

export interface JudgePerJudge {
  role: JudgeRole;
  score: number;
  note: string;
}

/** One LLM call the judge made while scoring this request (a judge persona,
 *  the synthesizer, or the follow-up-quality scorer). EXACT — read from the
 *  provider's own response (lab/server/src/usage.ts), never estimated. */
export interface JudgeUsageCall {
  tag?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** EXACT token usage across every LLM call the judge made for this request.
 *  ABSENT on responses from a judge deployment that predates cost tracking
 *  (spike plan §6, Phase 3) — always optional, never assumed present. */
export interface JudgeUsage {
  calls: JudgeUsageCall[];
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  hasUnpricedCalls?: boolean;
}

export interface JudgeVerdict {
  panelId: string;
  dims: JudgeDims;
  dimensions?: JudgeDimension[];
  synthesizedScore: number;
  /** The "Confidence" composite (0-10), post-gate. */
  composite: number;
  preGateScore: number;
  gateTripped: boolean;
  /** True iff a solo (uncorroborated) flag exists and the gate did NOT trip — visible, non-capping. */
  borderline: boolean;
  flaggedClaims: JudgeFlaggedClaim[];
  /** Claim clusters flagged by >= 2 distinct judges — what capped the score when `gateTripped`. Absent on an older judge response. */
  corroboratedClusters?: JudgeCluster[];
  /** Claim clusters flagged by exactly one judge — surfaced for visibility, never cap. Absent on an older judge response. */
  soloFlags?: JudgeCluster[];
  /**
   * Corroborated LLM clusters that did NOT cap the score, because the served
   * gate runs on the deterministic check (2026-07-28). Advisory: show them, do
   * not score them. Absent on an older judge response.
   */
  advisoryClusters?: JudgeCluster[];
  /**
   * THE GROUNDING CLAIM THE CHIP DISPLAYS. Reproducible: a verbatim search for
   * the terms that cannot be paraphrased (code identifiers, scaled numbers,
   * CamelCase API names), true iff every one was located in the sources.
   *
   * ABSENT on a judge deployment predating 2026-07-28 — and in that case the
   * chip must render an "unavailable" state rather than falling back to
   * `composite`. The composite fuses one validated signal with three that have
   * never been validated against anyone's judgement, so showing it as a
   * confidence number is false precision.
   */
  grounded?: boolean;
  /** Hard terms found in NO source. Empty iff `grounded`. */
  unsupportedTerms?: { term: string; kind: string }[];
  /** How many hard terms were searched for. 0 = pure prose, nothing to verify. */
  termsChecked?: number;
  /** Which mechanism decided the cap. "deterministic" on the current served path. */
  groundingMode?: 'deterministic' | 'llm';
  perJudge: JudgePerJudge[];
  rationale: string;
  /** Set only when THIS panel failed (service error, bad response shape, etc). */
  error?: string;
  /**
   * EXACT usage across the WHOLE /api/judge request this panel came from
   * (not just this one panel — the server accumulates per-request, see
   * lab/server/src/judge/judgeHandler.ts). Absent on an older judge
   * deployment (tolerant parse — see judgeAnswer below) or on an error
   * verdict. Cost tracking §6.
   */
  usage?: JudgeUsage;
}

export interface JudgeSourceInput {
  id: string;
  title?: string;
  url?: string;
  /** Substantive body the grounding gate checks claims against. */
  text: string;
}

interface JudgePanelRequest {
  panelId: string;
  label?: string;
  answer: string;
  sources: JudgeSourceInput[];
}

interface JudgeRequestBody {
  question: string;
  panels: JudgePanelRequest[];
  isRefusalTest?: boolean;
  rounds?: number;
}

interface LiveJudgeResultBody {
  rounds: number;
  panels: JudgeVerdict[];
  /** Request-scoped EXACT usage (lab/server/src/usage.ts). Optional — an
   *  older judge deployment simply won't send it (tolerant parse). */
  usage?: JudgeUsage;
}

/** Base URL of the judge HTTP service. Override with VITE_JUDGE_URL.
 *  Optional chaining on `import.meta.env` is deliberate: under Vite it's
 *  always defined (statically replaced at build time), but this same module
 *  is also exercised directly under plain Node/tsx for the live integration
 *  check (no Vite define pass) — there, `import.meta.env` is `undefined`,
 *  and without the `?.` this throws before the fallback ever runs. */
export function judgeServiceUrl(): string {
  return (import.meta.env?.VITE_JUDGE_URL as string | undefined) || 'http://localhost:8788';
}

/** The shared secret the hosted judge requires as `x-lab-key` (lab/server auth).
 *  Undefined when unset — an unauthenticated local judge needs no header. */
export function labApiKey(): string | undefined {
  const k = import.meta.env?.VITE_LAB_API_KEY as string | undefined;
  return k && k.trim() ? k : undefined;
}

// ---------------------------------------------------------------------------
// Hit -> judge source mapping
// ---------------------------------------------------------------------------

/**
 * Candidate field names for a raw Agent Studio `a:` hit's substantive body
 * text, richest-first. Confirmed empirically against the live
 * ACS_SPECTRUM_MULTI index (`mcp__algolia__searchSingleIndex`, 2026-07-02):
 * records carry a full-text `body` field (the crawler ingest scripts
 * `scripts/crawler/ingest_site.mjs`/`ingest_git_docs.mjs` write
 * `{ ..., title, body, bodyLen }`). Agent Studio's search tool has no
 * `attributesToRetrieve` restriction configured (`scripts/agents/
 * build_acs_agents.mjs`), so the index default (`["*"]`) applies and `body`
 * should reach the `a:` tool-result frame unchanged. The extra candidate
 * names (content/text/snippet/summary/description) are defensive — Agent
 * Studio's tool call is not directly inspectable without a live browser
 * session (gated), so this checks the richest-first candidate that is
 * actually present rather than hardcoding a single field name.
 */
const BODY_FIELD_PRIORITY = ['body', 'content', 'text', 'snippet', 'summary', 'description'] as const;

/** Pick the fullest body/content text present on a raw hit, falling back to
 *  the title when no body-shaped field exists (thin/title-only hit). */
function pickHitText(hit: Record<string, unknown>): string {
  let best = '';
  for (const key of BODY_FIELD_PRIORITY) {
    const v = hit[key];
    if (typeof v === 'string' && v.trim().length > best.length) best = v;
  }
  if (best) return best;
  const title = hit.title;
  return typeof title === 'string' ? title : '';
}

/** Map one raw `a:` hit (as collected by agentStudio.ts's collectHits) into
 *  the judge's {id, title, url, text} source shape. */
export function mapHitToJudgeSource(hit: Record<string, unknown>): JudgeSourceInput {
  const title = typeof hit.title === 'string' && hit.title.trim() ? hit.title : undefined;
  const url = typeof hit.url === 'string' && hit.url.trim() ? hit.url : undefined;
  const objectId = typeof hit.objectID === 'string' && hit.objectID.trim() ? hit.objectID : undefined;
  const id = objectId ?? url ?? title ?? crypto.randomUUID();
  return { id, title, url, text: pickHitText(hit) };
}

export function mapHitsToJudgeSources(hits: Record<string, unknown>[]): JudgeSourceInput[] {
  return hits.map(mapHitToJudgeSource);
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface JudgeAnswerInput {
  question: string;
  answer: string;
  /** Raw `a:` hits for the answer being judged (AnswerSegment.rawHits). */
  hits: Record<string, unknown>[];
  isRefusalTest?: boolean;
  panelId?: string;
  label?: string;
}

function errorVerdict(panelId: string, message: string): JudgeVerdict {
  return {
    panelId,
    dims: { usefulness: 0 },
    synthesizedScore: 0,
    composite: 0,
    preGateScore: 0,
    gateTripped: false,
    borderline: false,
    flaggedClaims: [],
    perJudge: [],
    rationale: '',
    error: message,
  };
}

/**
 * Judge one assistant answer. Always resolves — network failures, non-2xx
 * responses, and malformed response bodies all become an error verdict
 * (`error` set) rather than a thrown exception, so a judge outage never
 * breaks the chat UI.
 */
export async function judgeAnswer(
  input: JudgeAnswerInput,
  fetchImpl: typeof fetch = fetch,
): Promise<JudgeVerdict> {
  const panelId = input.panelId ?? 'main';

  const body: JudgeRequestBody = {
    question: input.question,
    rounds: 1,
    ...(input.isRefusalTest !== undefined ? { isRefusalTest: input.isRefusalTest } : {}),
    panels: [
      {
        panelId,
        ...(input.label ? { label: input.label } : {}),
        answer: input.answer,
        sources: mapHitsToJudgeSources(input.hits),
      },
    ],
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = labApiKey();
  if (key) headers['x-lab-key'] = key;

  let res: Response;
  try {
    res = await fetchImpl(`${judgeServiceUrl()}/api/judge`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return errorVerdict(panelId, err instanceof Error ? err.message : String(err));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return errorVerdict(panelId, `Judge service error ${res.status}: ${text.slice(0, 300)}`);
  }

  let parsed: LiveJudgeResultBody;
  try {
    parsed = (await res.json()) as LiveJudgeResultBody;
  } catch (err) {
    return errorVerdict(panelId, `Judge service returned an unparseable response: ${err instanceof Error ? err.message : String(err)}`);
  }

  const verdict = parsed.panels?.[0];
  if (!verdict) return errorVerdict(panelId, 'Judge service returned no panel verdict.');
  // Request-scoped usage lives alongside `panels`, not inside the panel
  // itself (the server accumulates it once per request) — fold it onto the
  // verdict we hand back so callers have one object to read. Absent on an
  // older judge deployment; `verdict.usage` then simply stays undefined.
  return parsed.usage ? { ...verdict, usage: parsed.usage } : verdict;
}
