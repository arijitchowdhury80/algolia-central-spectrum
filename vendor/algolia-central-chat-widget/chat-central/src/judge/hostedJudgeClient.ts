/**
 * hostedJudgeClient — talks to the judge HTTP service
 * (`POST /api/judge`, `npm run judge:serve`, default port 8788) to grade an
 * assistant answer for grounding/coverage/depth/relevance.
 *
 * Wire contract (Read Receipt — lab/judge/README.md §4b "HTTP service",
 * lines 181-232):
 *   POST /api/judge  { question, panels:[{panelId, label?, answer,
 *     sources:[{id,title?,url?,text}]}], isRefusalTest?, rounds }
 *   -> LiveJudgeResult { rounds, panels:[{panelId, dims:{grounding,coverage,
 *     depth,relevance}, synthesizedScore, composite, preGateScore,
 *     gateTripped, borderline, flaggedClaims:[{claim,reason,certainty}],
 *     perJudge:[{role,score,note}], rationale, error?}] }
 * `Source.text` is what grounding is scored against — it must be the
 * record's real body, not just its title (README §5).
 *
 * Live judging is indicative (1 round, fast model) — see useJudge.ts.
 * This client NEVER throws into render: any network/HTTP/parse failure
 * resolves to an error verdict (`error` set, all scores 0) instead.
 *
 * `judgeAnswer` accepts an optional `JudgeRuntimeConfig` override that takes
 * precedence over the global env singleton. useJudge supplies this from the
 * IS renderState (via the chatConfidence widget) so all judge config flows
 * through the widget system rather than the global env singleton.
 */

import { getRuntimeEnv } from '../config/runtime';
import { activeInstance } from '../config/active';
import type {
  JudgeAgentDescriptor,
  JudgeAnswerInput,
  JudgeErrorKind,
  JudgeSourceInput,
  JudgeVerdict,
} from './types';

// Shared judge types now live in ./types. Re-export them so existing importers
// of this module keep working (they can also import from ./types directly).
export type {
  JudgeAnswerInput,
  JudgeDimension,
  JudgeDims,
  JudgeErrorKind,
  JudgeFlaggedClaim,
  JudgePerJudge,
  JudgeRole,
  JudgeSourceInput,
  JudgeVerdict,
} from './types';

// ── Runtime config override ───────────────────────────────────────────────────

/**
 * Optional runtime config override passed to `judgeAnswer` by `useJudge`.
 * When present, these values take precedence over the global env singleton
 * (`getRuntimeEnv()`), allowing the chatConfidence IS widget to fully own the
 * judge configuration without mutating shared state.
 */
export interface JudgeRuntimeConfig {
  /** Which judge backend to use. */
  mode?: 'hosted' | 'algolia' | 'off';
  /** Override URL for the hosted judge service. */
  url?: string;
  /** Auth key for the hosted judge service. */
  apiKey?: string;
  /**
   * Judge agents used in algolia mode. Each agent acts as an LLM seam for the
   * @confidence-engine. An entry whose `role` names a temperament
   * (`skeptic` / `referee` / `advocate`) drives ONLY that judge; every other
   * judge (and the synthesizer) uses the default agent — the first role-less
   * entry, else the env/instance judge backend, else the first entry overall.
   * A single role-less entry therefore powers all three judges.
   */
  agents?: JudgeAgentDescriptor[];
}

// ── Env-based accessors (global fallback) ─────────────────────────────────────

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
}

/** Base URL of the judge HTTP service. Override with VITE_JUDGE_URL.
 *  Optional chaining on `import.meta.env` is deliberate: under Vite it's
 *  always defined (statically replaced at build time), but this same module
 *  is also exercised directly under plain Node/tsx for the live integration
 *  check (no Vite define pass) — there, `import.meta.env` is `undefined`,
 *  and without the `?.` this throws before the fallback ever runs. */
export function judgeServiceUrl(): string {
  return getRuntimeEnv()?.judgeUrl || import.meta.env?.VITE_JUDGE_URL || 'http://localhost:8788';
}

/** The shared secret the hosted judge requires as `x-judge-api-key` (judge service auth).
 *  Undefined when unset — an unauthenticated local judge needs no header. */
export function judgeApiKey(): string | undefined {
  const k = getRuntimeEnv()?.judgeApiKey ?? import.meta.env?.VITE_JUDGE_API_KEY;
  return k && k.trim() ? k : undefined;
}

/** Which judge backend the chip uses. `hosted` (default, and the only mode ACS
 *  supports) = the VPS judge HTTP service (this file). `algolia` (in-browser judge,
 *  vendored upstream) is intentionally NOT wired up — ACS's deterministic grounding
 *  gate lives in code (`@lab/judge`), not inside an Agent Studio agent's own
 *  synthesis, so `judgeAnswer` returns an error verdict for that mode instead of
 *  importing the vendored engine. See vendor/README.md. */
export function judgeMode(): 'hosted' | 'algolia' {
  const mode = getRuntimeEnv()?.judgeMode ?? import.meta.env?.VITE_JUDGE_MODE;
  return mode === 'algolia' ? 'algolia' : 'hosted';
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
const BODY_FIELD_PRIORITY = [
  'body',
  'content',
  'text',
  'snippet',
  'summary',
  'description',
] as const;

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

/** Extract a non-empty string field from a raw hit, returning undefined if absent/empty. */
function extractHitString(hit: Record<string, unknown>, field: string): string | undefined {
  const v = hit[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Map one raw `a:` hit (as collected by agentStudio.ts's collectHits) into
 *  the judge's {id, title, url, text} source shape. */
export function mapHitToJudgeSource(hit: Record<string, unknown>): JudgeSourceInput {
  const title = extractHitString(hit, 'title');
  const url = extractHitString(hit, 'url');
  const objectId = extractHitString(hit, 'objectID');
  const id = objectId ?? url ?? title ?? crypto.randomUUID();
  return { id, title, url, text: pickHitText(hit) };
}

/**
 * Map raw hits into judge sources, collapsing repeats of the same record.
 *
 * A turn can run several searches, and `rawHits` accumulates them all, so the
 * same page routinely arrives more than once. Duplicates add no evidence but
 * still consume the per-source excerpt budget, which starves the judges of the
 * text they score grounding against. Keeping the first occurrence preserves
 * retrieval order; the longest text wins so a fuller copy is never dropped in
 * favour of a thin one.
 */
export function mapHitsToJudgeSources(hits: Record<string, unknown>[]): JudgeSourceInput[] {
  const byId = new Map<string, JudgeSourceInput>();
  for (const hit of hits) {
    const source = mapHitToJudgeSource(hit);
    const seen = byId.get(source.id);
    if (!seen) byId.set(source.id, source);
    else if (source.text.length > seen.text.length) byId.set(source.id, source);
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

function errorVerdict(panelId: string, message: string, kind: JudgeErrorKind): JudgeVerdict {
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
    errorKind: kind,
  };
}

/** Map an HTTP status from the judge service to a UI error category. */
function kindFromStatus(status: number): JudgeErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  return 'server';
}

function buildJudgeRequestBody(input: JudgeAnswerInput, panelId: string): JudgeRequestBody {
  return {
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
}

function buildJudgeHeaders(apiKeyOverride?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKeyOverride ?? judgeApiKey();
  if (key) headers['x-judge-api-key'] = key;
  return headers;
}

async function parseJudgeResponse(res: Response, panelId: string): Promise<JudgeVerdict> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return errorVerdict(
      panelId,
      `Judge service error ${res.status}: ${text.slice(0, 300)}`,
      kindFromStatus(res.status),
    );
  }

  let parsed: LiveJudgeResultBody;
  try {
    parsed = (await res.json()) as LiveJudgeResultBody;
  } catch (err) {
    return errorVerdict(
      panelId,
      `Judge service returned an unparseable response: ${err instanceof Error ? err.message : String(err)}`,
      'bad-response',
    );
  }

  const verdict = parsed.panels?.[0];
  if (!verdict)
    return errorVerdict(panelId, 'Judge service returned no panel verdict.', 'bad-response');
  return verdict;
}

/** POST one judge request to the hosted VPS service and return the verdict. */
async function postToHostedJudge(
  input: JudgeAnswerInput,
  panelId: string,
  config: Pick<JudgeRuntimeConfig, 'url' | 'apiKey'> | undefined,
  fetchImpl: typeof fetch,
): Promise<JudgeVerdict> {
  const serviceUrl = config?.url ?? judgeServiceUrl();
  let res: Response;
  try {
    res = await fetchImpl(`${serviceUrl}/api/judge`, {
      method: 'POST',
      headers: buildJudgeHeaders(config?.apiKey),
      body: JSON.stringify(buildJudgeRequestBody(input, panelId)),
    });
  } catch (err) {
    return errorVerdict(panelId, err instanceof Error ? err.message : String(err), 'offline');
  }
  return parseJudgeResponse(res, panelId);
}

// ---------------------------------------------------------------------------
// Fast path: grounding only
// ---------------------------------------------------------------------------

/** One panel's grounding-only result, as returned by `POST /api/ground`. */
interface GroundResultBody {
  panels?: {
    panelId: string;
    grounded: boolean;
    termsChecked: number;
    unsupportedTerms?: { term: string; kind?: string }[];
    groundingMode?: string;
  }[];
}

/**
 * Ask a hosted judge for the DETERMINISTIC GROUNDING VERDICT ONLY.
 *
 * A full judge request costs three LLM calls — measured at 18-32s each on a real
 * panel — but the badge displays only the grounding result, which the backend
 * computes with a string search in about 8ms. `POST /api/ground` returns that
 * half on its own so the badge can render at the moment the answer finishes
 * instead of half a minute later.
 *
 * Returns `null` — never an error verdict — when the endpoint is missing (an
 * older judge deployment returns 404) or unreachable. This is an OPTIMISATION:
 * if it is unavailable the caller simply waits for the full verdict, exactly as
 * before. Turning a fast-path miss into a visible error would make a backend
 * without this route look broken when it is merely older.
 */
/** POST the panel to `/api/ground`, or null on ANY transport/HTTP failure. */
async function postToGroundRoute(
  input: JudgeAnswerInput,
  panelId: string,
  config: Pick<JudgeRuntimeConfig, 'url' | 'apiKey'> | undefined,
  fetchImpl: typeof fetch,
): Promise<GroundResultBody | null> {
  const serviceUrl = config?.url ?? judgeServiceUrl();
  try {
    const res = await fetchImpl(`${serviceUrl}/api/ground`, {
      method: 'POST',
      headers: buildJudgeHeaders(config?.apiKey),
      body: JSON.stringify(buildJudgeRequestBody(input, panelId)),
    });
    if (!res.ok) return null;
    return (await res.json()) as GroundResultBody;
  } catch {
    return null;
  }
}

/** Shape a grounding-only response into a JudgeVerdict. Scores are deliberately
 *  zero AND `panelPending`, so a consumer renders the grounding result and never
 *  a 0.0 composite. */
function toPendingVerdict(
  panel: NonNullable<GroundResultBody['panels']>[number],
  fallbackPanelId: string,
): JudgeVerdict {
  return {
    panelId: panel.panelId ?? fallbackPanelId,
    dims: {},
    synthesizedScore: 0,
    composite: 0,
    preGateScore: 0,
    gateTripped: false,
    borderline: false,
    flaggedClaims: [],
    perJudge: [],
    rationale: '',
    grounded: panel.grounded,
    termsChecked: panel.termsChecked,
    unsupportedTerms: panel.unsupportedTerms ?? [],
    groundingMode: panel.groundingMode ?? 'deterministic',
    panelPending: true,
  };
}

/** Only the hosted backend has the `/api/ground` route: `algolia` mode runs the
 *  engine in-browser, where there is no cheap half to ask for. */
function hasGroundRoute(config: JudgeRuntimeConfig | undefined): boolean {
  const mode = config?.mode ?? judgeMode();
  return mode === 'hosted';
}

/** The first panel of a grounding response, if it is usable. */
function usableGroundPanel(
  parsed: GroundResultBody | null,
): NonNullable<GroundResultBody['panels']>[number] | null {
  const panel = parsed?.panels?.[0];
  if (!panel) return null;
  return typeof panel.grounded === 'boolean' ? panel : null;
}

export async function groundAnswer(
  input: JudgeAnswerInput,
  fetchImpl: typeof fetch = fetch,
  config?: JudgeRuntimeConfig,
): Promise<JudgeVerdict | null> {
  if (!hasGroundRoute(config)) return null;
  const panelId = input.panelId ?? 'main';
  const panel = usableGroundPanel(await postToGroundRoute(input, panelId, config, fetchImpl));
  return panel ? toPendingVerdict(panel, panelId) : null;
}

/**
 * Judge one assistant answer. Always resolves — network failures, non-2xx
 * responses, and malformed response bodies all become an error verdict
 * (`error` set) rather than a thrown exception, so a judge outage never
 * breaks the chat UI.
 *
 * When `config` is provided it takes precedence over the global env singleton
 * (`getRuntimeEnv()`). useJudge supplies this from the IS renderState so judge
 * configuration flows through the widget system without touching the env singleton.
 *
 * Mode dispatch:
 *   `off`     — returns a silent skip verdict (no network call)
 *   `algolia` — not supported by ACS; returns an error verdict (see judgeMode() above)
 *   `hosted`  — POSTs to the VPS judge service (default)
 */
export async function judgeAnswer(
  input: JudgeAnswerInput,
  fetchImpl: typeof fetch = fetch,
  config?: JudgeRuntimeConfig,
): Promise<JudgeVerdict> {
  const effectiveMode = config?.mode ?? judgeMode();
  const panelId = input.panelId ?? 'main';

  if (effectiveMode === 'off') {
    return errorVerdict(panelId, activeInstance.strings.judge.disabledMessage, 'server');
  }

  if (effectiveMode === 'algolia') {
    return errorVerdict(
      panelId,
      'mode="algolia" (in-browser judge) is not supported by this deployment — the ' +
        'deterministic grounding gate runs server-side. Set VITE_JUDGE_MODE to "hosted".',
      'server',
    );
  }

  return postToHostedJudge(input, panelId, config, fetchImpl);
}
