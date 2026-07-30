import type { Judgment, Source } from "./types.js";

/**
 * Traceable-excerpt post-validation. A deterministic, no-LLM step that runs AFTER
 * parseJudgeOutput and BEFORE the gate — it needs the Source texts, which
 * parse.ts doesn't have.
 *
 * Fuzzy tolerance is decided EXACTLY: normalized-whitespace + case-
 * insensitive SUBSTRING match only. No token-overlap, no edit-distance, no
 * ellipsis handling. If a judge couldn't copy 8-40 words verbatim, the flag
 * is treated as unreliable (demoted, not gate-eligible — see gate.ts §3.2
 * rule 3). Strictness here is a feature, not a bug.
 */

/** Common HTML entities left in crawled source bodies (the v3 pages are full of them). */
const ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/&nbsp;/g, " "], [/&amp;/g, "&"], [/&lt;/g, "<"], [/&gt;/g, ">"],
  [/&quot;/g, '"'], [/&#x27;|&#39;|&apos;/g, "'"], [/&#x2F;|&#47;/g, "/"],
];

/**
 * Normalize for verbatim matching: decode common HTML entities, strip markdown
 * emphasis/code punctuation, unify quote and dash characters, lowercase,
 * collapse whitespace, trim.
 *
 * MARKUP-BLINDNESS IS DELIBERATE (2026-07-28). Previously this did lowercase +
 * whitespace only, and that silently broke the gate on a developer-docs corpus.
 * Sources are markdown with `code spans` (source S1 of one calibration case
 * alone holds 148 backticks) and crawled HTML with entities; a judge quoting a
 * sentence writes the plain text. Measured effect: all three judges caught an
 * injected fabricated prop name at certainty 1.0, and all three flags were
 * demoted for a failed excerpt check — the answer scored 10.00/10. The
 * mismatch was one pair of backticks around the identifier.
 *
 * This does NOT loosen the anti-fabrication intent. Still an exact
 * substring match on the remaining characters — no token overlap, no edit
 * distance, no ellipsis handling. A judge that invents a quote still fails.
 * It only stops punctuation that carries no meaning from deciding the outcome.
 *
 * Pure.
 */
export function normalizeForExcerpt(s: string): string {
  let out = s;
  for (const [re, to] of ENTITIES) out = out.replace(re, to);
  return out
    .toLowerCase()
    .replace(/[`*_]/g, "")          // markdown code/emphasis
    .replace(/[‘’]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/[–—]/g, "-") // en/em dash
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * For each violation with a non-empty excerpt, sets excerptVerified = true iff
 * normalizeForExcerpt(excerpt) is a substring of normalizeForExcerpt(source.text)
 * for the source whose id === violation.sourceId.
 *   - Empty excerpt → excerptVerified = false (nothing to verify; the gate's
 *     rule 3 treats "" as the allowed pure-fabrication path, NOT as a failed
 *     check — this flag stays false only as "no excerpt to verify").
 *   - Unknown sourceId → false.
 * Returns a NEW judgments array (pure, does not mutate inputs).
 */
export function verifyExcerpts(
  judgments: readonly Judgment[],
  sources: readonly Source[],
): Judgment[] {
  const sourcesById = new Map(sources.map((s) => [s.id, s]));

  return judgments.map((j) => ({
    ...j,
    groundingViolations: j.groundingViolations.map((v) => {
      const excerpt = v.excerpt ?? "";
      if (excerpt === "") {
        return { ...v, excerptVerified: false };
      }
      const source = sourcesById.get(v.sourceId ?? "");
      if (!source) {
        return { ...v, excerptVerified: false };
      }
      const verified = normalizeForExcerpt(source.text).includes(
        normalizeForExcerpt(excerpt),
      );
      return { ...v, excerptVerified: verified };
    }),
  }));
}
