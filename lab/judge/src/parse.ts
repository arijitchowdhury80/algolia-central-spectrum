import type {
  DimensionScore,
  GroundingViolation,
  Rubric,
} from "./types.js";

/** Shape the LLM is contracted to emit (see prompt.JUDGE_OUTPUT_CONTRACT). */
export interface RawJudgeOutput {
  dimensionScores: { dimensionId: string; score: number; rationale?: string }[];
  /**
   * Per-claim certainty was renamed `confidence` → `certainty` (2026-06-27) so it
   * never collides with the answer-level "Confidence" composite. We still accept a
   * legacy `confidence` key on input for back-compat with cached/older outputs.
   */
  groundingViolations?: {
    claim: string;
    reason?: string;
    certainty?: number;
    confidence?: number;
    kind?: string;
  }[];
  summary?: string;
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Normalise a dimension key for tolerant matching: lowercase, alphanumerics only. */
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Build a resolver mapping any incoming dimension key to the canonical rubric
 * `id`. Strong LLMs frequently echo the human LABEL ("Depth / rigor") rather
 * than the machine id ("depth"); without this, aggregation can't match the
 * score to the dimension and silently floors it to the rubric minimum. We match
 * on a normalised form of BOTH id and label. Unknown keys pass through unchanged
 * (no regression — they simply won't match, exactly as before).
 */
function buildDimensionResolver(rubric: Rubric): (raw: string) => string {
  const lookup = new Map<string, string>();
  for (const dim of rubric.dimensions) {
    lookup.set(normalizeKey(dim.id), dim.id);
    lookup.set(normalizeKey(dim.label), dim.id);
  }
  return (raw: string) => lookup.get(normalizeKey(raw)) ?? raw;
}

/**
 * Extracts the first balanced JSON object from a raw LLM string. LLMs often
 * wrap JSON in prose or code fences; this finds the outermost { ... }.
 * Pure; throws on no parseable object.
 */
export function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in judge output.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = raw.slice(start, i + 1);
        return JSON.parse(slice);
      }
    }
  }
  throw new Error("Unbalanced JSON object in judge output.");
}

/**
 * Parses + normalises a raw judge LLM output into typed, clamped structures.
 * Scores are clamped to the rubric range; violation certainty to [0,1].
 * Pure: no I/O.
 */
export function parseJudgeOutput(
  raw: string,
  rubric: Rubric,
): {
  dimensionScores: DimensionScore[];
  groundingViolations: GroundingViolation[];
  summary: string;
} {
  const obj = extractJsonObject(raw) as RawJudgeOutput;
  const resolveDimensionId = buildDimensionResolver(rubric);

  const dimensionScores: DimensionScore[] = (obj.dimensionScores ?? []).map((d) => ({
    dimensionId: resolveDimensionId(String(d.dimensionId)),
    score: clamp(Number(d.score), rubric.min, rubric.max),
    rationale: String(d.rationale ?? ""),
  }));

  const groundingViolations: GroundingViolation[] = (obj.groundingViolations ?? []).map(
    (v) => ({
      claim: String(v.claim),
      reason: String(v.reason ?? ""),
      // Output is `certainty`; accept legacy `confidence` on input for back-compat.
      certainty: clamp(Number(v.certainty ?? v.confidence ?? 1), 0, 1),
      // Only "unverifiable" is special (it won't trip the gate); anything else
      // (incl. absent/garbled) defaults to "contradicted" — the safe, gating value.
      kind: v.kind === "unverifiable" ? "unverifiable" : "contradicted",
    }),
  );

  return {
    dimensionScores,
    groundingViolations,
    summary: String(obj.summary ?? ""),
  };
}
