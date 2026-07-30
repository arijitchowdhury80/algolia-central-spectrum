/**
 * offer — pure deep-dive-offer helpers (no React, no transport; pure string
 * logic, matching this repo's test style).
 *
 * The `SPECIALIST:`-prefixed line is the classifier's deep-dive signal. It is
 * pulled OUT of the suggestions list (`extractDeepDiveOffer`) so it never
 * renders as an ordinary follow-up chip, and `filterSuggestions` keeps it out
 * of any raw suggestion list surfaced in the prompt.
 */

const SPECIALIST_PREFIX = 'SPECIALIST:';

function isSpecialist(s: string): boolean {
  return s.trim().toUpperCase().startsWith(SPECIALIST_PREFIX);
}

/** Pull the first `SPECIALIST:`-prefixed deep-dive offer out of a turn's
 *  suggestions. Returns its trimmed remainder as `offer` and the remaining
 *  suggestions as `rest` (the matched entry removed so it never also renders as
 *  an ordinary follow-up). If none is prefixed, returns `{ rest: suggestions }`
 *  unchanged. */
export function extractDeepDiveOffer(
  suggestions: string[],
): { offer?: string; rest: string[] } {
  // Normalize (trim + uppercase) before matching to tolerate the whitespace/case
  // drift a live LLM completion can emit (' SPECIALIST:', 'Specialist:'), but
  // slice the prefix off the trimmed ORIGINAL so the offer text keeps its casing.
  const idx = suggestions.findIndex(isSpecialist);
  if (idx === -1) return { rest: suggestions };
  return {
    offer: suggestions[idx].trim().slice(SPECIALIST_PREFIX.length).trim(),
    rest: suggestions.filter((_, i) => i !== idx),
  };
}

/** Derive the turn's offer state from its suggestions in ONE place, so
 *  `deepDiveOffered` and `deepDiveQuery` are always sourced from the same
 *  `offer` value and can never disagree (architecture-review Critical #2).
 *  `deepDiveQuery` is `turnQuery` verbatim when an offer exists — never a
 *  concatenation with Generic's answer (Critical #1). */
export function deriveOfferState(
  suggestions: string[],
  turnQuery: string,
): { deepDiveOffered: boolean; followUp?: string; deepDiveQuery?: string } {
  const { offer, rest } = extractDeepDiveOffer(suggestions);
  return {
    deepDiveOffered: !!offer,
    followUp: rest[0],
    deepDiveQuery: offer ? turnQuery : undefined,
  };
}
