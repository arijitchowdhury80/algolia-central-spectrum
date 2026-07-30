/**
 * detGround — DETERMINISTIC grounding check. The reproducible half of the
 * grounding verdict, and (per the 2026-07-28 decision) the ONLY thing
 * allowed to cap the served score.
 *
 * WHY THIS EXISTS
 * ---------------
 * The LLM judge panel cannot produce a reproducible grounding verdict. Measured
 * 2026-07-28 on one clean, verified-grounded answer, identical input each time:
 *
 *   tightened gate, 1 round   gated 4/6   sd 2.78   scores {3.00, 8.89}
 *   tightened gate, 3 rounds  gated 3/5   sd 2.88   scores {3.00, 8.89}
 *   legacy gate,    1 round   gated 2/5   sd 2.88   scores {3.00, 8.89}
 *
 * Gate configuration only shifts the PROBABILITY of gating, never the
 * stability, and multi-round voting does not fix it (the bias is systematic,
 * not noise). Root cause: an LLM cannot prove a negative over ~90k characters
 * of source, so asked "is this claim absent?" it guesses, and the guess lands
 * on the threshold.
 *
 * Absence is a SEARCH problem. Search answers it exactly, and identically every
 * time. This module is a pure function of (answer, sources).
 *
 * MEASURED (36-case ground-truth set):
 *
 *   LLM panel      precision 0.95   recall 0.79   reproducible NO
 *   deterministic  precision 1.00   recall 0.58   reproducible YES
 *
 * The recall gap is deliberate and is covered by keeping LLM findings as
 * ADVISORY output (they catch `unsupported_add` 8/8 where this catches 0/8).
 * Advisory findings are displayed; they do not move the number.
 *
 * WHAT THIS CHECKS — AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------
 * Only term classes where verbatim presence is REQUIRED for a claim to be
 * grounded, because they cannot be legitimately paraphrased:
 *
 *   code identifiers     `allowsNonContiguousRanges`, `isInvalid`, `@scope/pkg`
 *   scaled numbers       1.125, 8601, font-size-100
 *   API/component names  DisclosurePanel, CustomDialog  (CamelCase)
 *
 * Prose is NOT checked. "a size smaller" vs "one size smaller" is a legitimate
 * paraphrase, and a verbatim rule over prose false-positives constantly —
 * measured: 8 of 124 extracted terms on clean answers were absent verbatim
 * purely through rewording.
 *
 * So this is a HIGH-PRECISION check, not a replacement for judgment.
 */

/** HTML entities the corpus carries, decoded before matching. */
const ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/&nbsp;/g, " "],
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#x27;|&#39;|&apos;/g, "'"],
];

/**
 * Markup-blind normalisation — the SAME shape as the judge's excerpt verifier
 * (excerptCheck.ts). Backticks and emphasis are stripped because a source
 * writes `` `allowsNonContiguousRanges` `` and an answer writes it bare; a
 * naive substring match diverges at character 4 and reports a grounded term as
 * fabricated. Pure.
 */
export function normalizeForGrounding(s: string): string {
  let out = s;
  for (const [re, to] of ENTITIES) out = out.replace(re, to);
  return out
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The class of a hard term — why its verbatim presence is required. */
export type HardTermKind = "identifier" | "number" | "component";

/** One extracted hard term and the sources it was located in. */
export interface CheckedTerm {
  readonly term: string;
  readonly kind: HardTermKind;
  /** Ids of every source containing the term (or one of its variants). Empty = unsupported. */
  readonly foundIn: readonly string[];
}

/** A hard term absent from every source — the reproducible grounding failure. */
export interface UnsupportedTerm {
  readonly term: string;
  readonly kind: HardTermKind;
}

/** The deterministic grounding verdict for one answer against its sources. */
export interface DeterministicGrounding {
  /** How many hard terms were extracted and searched for. */
  readonly checked: number;
  /** Terms whose every surface variant is absent from every source. */
  readonly unsupported: readonly UnsupportedTerm[];
  /** True iff nothing is unsupported. This is what gates the served score. */
  readonly grounded: boolean;
}

/** Words that look CamelCase but are prose/tooling names, not corpus API names. */
const CAMEL_STOP = new Set([
  "JavaScript",
  "TypeScript",
  "GitHub",
  "OpenAI",
  "ReactSpectrum",
  "AlgoliaSearch",
  "InstantSearch",
  "NodeJs",
  "WebKit",
  "SpectrumTwo",
]);

/**
 * Does this token carry identifier SHAPE — an uppercase letter, a scope/path
 * separator, or a digit-bearing / underscored segment? A plain lowercase
 * dictionary word does not, and must not be range-checked as an API name.
 * (Measured false positive this fixes: the backticked enum VALUE `"hour"`.)
 * Pure.
 */
function looksLikeIdentifier(t: string): boolean {
  if (/[A-Z]/.test(t)) return true;
  if (/^[@/]/.test(t) || t.includes("/") || t.includes("@")) return true;
  if (/-\d|\d-|_/.test(t)) return true;
  return false;
}

/**
 * Extract only terms whose grounding REQUIRES verbatim presence. Pure.
 *
 * Fenced code blocks are stripped first: a fenced example may legitimately
 * contain illustrative variable names that appear nowhere in the docs, and
 * flagging those would punish a good answer for writing a good example.
 */
/**
 * Cue words that mean the term right after them is being DENIED, not
 * asserted — "there's no `dismissDelay` prop", "Picker doesn't ship a
 * `loadingState`". A correct refusal necessarily names the exact fabricated
 * term it's refusing, and would otherwise flag itself as unsupported for
 * being honest — measured 2026-07-29 (F1 in the UX sweep): a bait question
 * asking about a non-existent prop got a correct "no, that doesn't exist"
 * answer, scored 3.0/10 UNSUPPORTED for naming the prop it just refuted.
 */
const NEGATION_RE =
  /\b(no|not|never|without|lacks?|lacking|non-?existent|nonexistent|no such)\b|n't\b/i;

/** Clause boundaries: sentence-enders, and comma-led contrast conjunctions
 *  ("X, but Y") so an assertion in one clause of a sentence cannot inherit a
 *  negation from a different clause of the SAME sentence. */
const CLAUSE_BOUNDARY_RE = /[.!?;\n]|,\s+(?:but|however|though|although|whereas|yet)\b/gi;

/** Does the clause CONTAINING this match (sentence- and contrast-clause-
 *  scoped, checked on both sides of the term) contain a negation cue?
 *  "no `dismissDelay` prop" and "`dismissDelay` is not a real prop" both
 *  count; a negation in a neighbouring clause of the same sentence does not.
 *  Pure. */
function isNegatedContext(body: string, matchIndex: number, matchLength: number): boolean {
  let clauseStart = 0;
  let clauseEnd = body.length;
  for (const b of body.matchAll(CLAUSE_BOUNDARY_RE)) {
    const boundaryEnd = (b.index ?? 0) + b[0].length;
    if (boundaryEnd <= matchIndex && boundaryEnd > clauseStart) clauseStart = boundaryEnd;
    if ((b.index ?? 0) >= matchIndex + matchLength && (b.index ?? 0) < clauseEnd) {
      clauseEnd = b.index ?? 0;
    }
  }
  return NEGATION_RE.test(body.slice(clauseStart, clauseEnd));
}

export function extractHardTerms(answer: string): CheckedTerm[] {
  const body = answer.replace(/```[\s\S]*?```/g, " ");
  const out = new Map<string, CheckedTerm & { assertedSomewhere: boolean }>();
  const add = (term: string, kind: HardTermKind, negated: boolean) => {
    const t = term.trim().replace(/^[.,;:()[\]]+|[.,;:()[\]]+$/g, "");
    if (t.length < 3 || t.length > 60) return;
    const key = t.toLowerCase();
    const existing = out.get(key);
    if (!existing) out.set(key, { term: t, kind, foundIn: [], assertedSomewhere: !negated });
    else if (!negated) existing.assertedSomewhere = true;
  };

  // Backticked spans: the strongest signal — the author marked it as code.
  for (const m of body.matchAll(/`([^`\n]{2,60})`/g)) {
    const inner = m[1];
    const negated = isNegatedContext(body, m.index ?? 0, m[0].length);
    if (/\s/.test(inner)) {
      // A backticked phrase with spaces is a snippet: keep only its
      // identifier-SHAPED tokens. A plain lowercase word inside a snippet is
      // prose and was a measured false positive.
      for (const id of inner.matchAll(/[@A-Za-z][A-Za-z0-9_\-/.]{3,}/g)) {
        if (looksLikeIdentifier(id[0])) add(id[0], "identifier", negated);
      }
    } else {
      // Strip quotes: `"hour"` is a string-literal enum VALUE, not an API name.
      const bare = inner.replace(/^['"]|['"]$/g, "");
      if (looksLikeIdentifier(bare)) add(bare, "identifier", negated);
    }
  }
  // Scaled / standard numbers. Bare small integers are skipped — they are list
  // indices and counts, not claims about the corpus.
  for (const m of body.matchAll(/(?<![\w.-])(\d+\.\d+|\d{3,})(?![\w-])/g)) {
    add(m[1], "number", isNegatedContext(body, m.index ?? 0, m[0].length));
  }
  // CamelCase API + component names.
  for (const m of body.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g)) {
    if (!CAMEL_STOP.has(m[1])) add(m[1], "component", isNegatedContext(body, m.index ?? 0, m[0].length));
  }
  // A term mentioned ONLY to be denied ("there's no `dismissDelay` prop") is
  // never a claim of existence, so it must never be checked — the entire
  // reason correctly naming a fabrication was being scored as fabricating it.
  return [...out.values()].filter((t) => t.assertedSomewhere).map(({ term, kind, foundIn }) => ({
    term,
    kind,
    foundIn,
  }));
}

/**
 * Surface variants that must count as the SAME term. Each was a measured false
 * positive on a verified-clean answer, so each is a real writing pattern rather
 * than a hypothetical:
 *
 *   plural        "StatusLights" / "TextFields"  — docs define the singular
 *   dot notation  "Accordion.Item"               — docs name the parts apart
 *   placeholder   "size-X"                       — X stands in for a value
 *
 * Matching ANY variant counts as grounded. This trades a little recall for
 * precision on purpose: a false "this answer is ungrounded" in front of a
 * prospect costs far more than a missed injection in a test. Pure.
 */
function variants(term: string): string[] {
  const out = new Set<string>([term]);
  if (/[a-z]s$/.test(term)) out.add(term.replace(/s$/, "")); // plural -> singular
  if (/ies$/.test(term)) out.add(term.replace(/ies$/, "y"));
  if (term.includes(".")) for (const p of term.split(".")) if (p.length > 2) out.add(p);
  const placeholder = term.match(/^(.*?)-(?:[A-Z]|\{[^}]*\}|N|n)$/);
  if (placeholder?.[1] && placeholder[1].length > 2) out.add(placeholder[1]);
  return [...out];
}

/**
 * Locate each term across sources; a term whose every variant is absent
 * everywhere is unsupported. Pure — same inputs always give the same answer,
 * which is the entire point of doing this without an LLM.
 */
export function checkTerms(
  terms: readonly CheckedTerm[],
  sources: readonly { readonly id: string; readonly text: string }[],
): CheckedTerm[] {
  const normed = sources.map((s) => ({ id: s.id, text: normalizeForGrounding(s.text) }));
  return terms.map((t) => {
    const vs = variants(t.term).map(normalizeForGrounding).filter(Boolean);
    return {
      ...t,
      foundIn: normed.filter((s) => vs.some((v) => s.text.includes(v))).map((s) => s.id),
    };
  });
}

/**
 * The deterministic grounding verdict for one answer. Pure, total, and
 * reproducible: no LLM, no I/O, no randomness. An answer with no hard terms at
 * all (pure prose, or a refusal) is `grounded: true` with `checked: 0` — this
 * check makes no claim about prose, and must never invent a failure it cannot
 * prove.
 */
export function deterministicGrounding(
  answer: string,
  sources: readonly { readonly id: string; readonly text: string }[],
): DeterministicGrounding {
  const checked = checkTerms(extractHardTerms(answer), sources);
  const unsupported = checked
    .filter((t) => t.foundIn.length === 0)
    .map((t) => ({ term: t.term, kind: t.kind }));
  return { checked: checked.length, unsupported, grounded: unsupported.length === 0 };
}
