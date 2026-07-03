/**
 * judgeClient — talks to the local `lab/server` judge HTTP service
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
 */

export type JudgeRole = 'skeptic' | 'referee' | 'advocate';

export interface JudgeDims {
  grounding: number;
  coverage: number;
  depth: number;
  relevance: number;
}

export interface JudgeDimension {
  id: string;
  label: string;
  score: number;
}

/** A claim the Skeptic flagged as unsupported by the sources. */
export interface JudgeFlaggedClaim {
  claim: string;
  reason: string;
  certainty: number;
}

export interface JudgePerJudge {
  role: JudgeRole;
  score: number;
  note: string;
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
  borderline: boolean;
  flaggedClaims: JudgeFlaggedClaim[];
  perJudge: JudgePerJudge[];
  rationale: string;
  /** Set only when THIS panel failed (service error, bad response shape, etc). */
  error?: string;
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

  let res: Response;
  try {
    res = await fetchImpl(`${judgeServiceUrl()}/api/judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  return verdict;
}
