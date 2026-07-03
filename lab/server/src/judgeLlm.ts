/**
 * judgeLlm — adapter around a raw LlmComplete for use BY the AI Judge.
 *
 * PORTED VERBATIM from AC2 lab/server/src/judgeLlm.ts (self-contained, only
 * imports @lab/judge's types).
 *
 * Why this exists: the judge module's prompt shows each rubric dimension as
 *   `- <id> ("<Label>", weight xN): ...`
 * and its parser keys strictly on `<id>`. Strong chat models frequently echo
 * the human LABEL back as `dimensionId` ("Groundedness", "Depth / rigor")
 * instead of the machine id ("groundedness", "depth"). The parser then can't
 * match the dimension, every score falls to the rubric min, and a good answer
 * scores ~0.
 *
 * We do NOT modify @lab/judge (a completed dependency). Instead this adapter
 * post-processes ONLY the judge JSON: it remaps any `dimensionId` that matches
 * a rubric label (case/space/punctuation-insensitive) back to the canonical id.
 * Synthesizer calls (prose) pass through untouched.
 */
import type { LlmComplete, LlmCompleteOptions, Rubric } from "@lab/judge";

/** Normalise a string for fuzzy id/label matching. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Build label/id -> canonical-id lookup for a rubric. */
function buildAliasMap(rubric: Rubric): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of rubric.dimensions) {
    map.set(norm(d.id), d.id);
    map.set(norm(d.label), d.id);
    // Common shorthands the model emits (first word of a slashed label).
    const firstWord = d.label.split(/[/&]/)[0];
    if (firstWord) map.set(norm(firstWord), d.id);
  }
  return map;
}

/**
 * Try to repair dimensionIds inside a judge JSON string. If the text isn't the
 * expected JSON shape, return it unchanged (the module's own parser is tolerant
 * and extracts the JSON object itself).
 */
function repairDimensionIds(raw: string, alias: Map<string, string>): string {
  // The module extracts the first {...}; mirror that loosely here.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return raw;

  const head = raw.slice(0, start);
  const tail = raw.slice(end + 1);
  const jsonText = raw.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return raw; // leave malformed JSON to the module's parser
  }

  if (!parsed || typeof parsed !== "object") return raw;
  const obj = parsed as Record<string, unknown>;
  const dims = obj.dimensionScores;
  if (!Array.isArray(dims)) return raw;

  let changed = false;
  for (const entry of dims) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.dimensionId !== "string") continue;
    const canonical = alias.get(norm(e.dimensionId));
    if (canonical && canonical !== e.dimensionId) {
      e.dimensionId = canonical;
      changed = true;
    }
  }

  if (!changed) return raw;
  return head + JSON.stringify(obj) + tail;
}

/**
 * Wrap a raw LlmComplete so judge outputs have their dimensionIds normalised to
 * the rubric's canonical ids. Detects judge calls by the `tag` the module sets
 * (`judge:<id>:round<N>`); everything else passes through unchanged.
 */
export function makeJudgeLlm(raw: LlmComplete, rubric: Rubric): LlmComplete {
  const alias = buildAliasMap(rubric);
  return async function judgeLlm(
    prompt: string,
    opts?: LlmCompleteOptions,
  ): Promise<string> {
    const out = await raw(prompt, opts);
    if (opts?.tag?.startsWith("judge:")) {
      return repairDimensionIds(out, alias);
    }
    return out;
  };
}
