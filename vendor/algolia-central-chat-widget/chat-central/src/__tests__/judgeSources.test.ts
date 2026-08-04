/**
 * Judge source preparation — dedupe + relevance excerpting.
 *
 * Regression cover for a grounding false-negative: the judges were handed the
 * first 2000 characters of each retrieved page, which on a docs site is the
 * navigation menu and a token enumeration. Claims the page documented further
 * down were scored UNSUPPORTED because the supporting prose never reached the
 * prompt.
 */
import { describe, expect, it } from 'vitest';
import { mapHitsToJudgeSources } from '../judge/hostedJudgeClient';
import { excerptSources } from '../judge/sourceExcerpt';

/**
 * Mirrors the real shape of the retrieved Style Macro page: a nav line that
 * merely names the utilities, a very long list of colour tokens, and the prose
 * that actually documents the API sitting tens of kilobytes in.
 */
function styleMacroLikeDoc(): string {
  const nav =
    'Select…\nStyle Macro Colors Dimensions Utilities baseColor color lightDark colorMix\n' +
    '# Style Macro\nThe `style` macro supports a constrained set of values per property.\n';
  const tokenList = Array.from({ length: 900 }, (_, i) => `accent-${(i % 16) + 1}00`).join('\n');
  const utilities =
    '\n## Utilities\n' +
    '### baseColor\n' +
    'Returns a set of stateful color token references for the default, hovered, ' +
    'focus-visible, and pressed states of a component.\n' +
    "backgroundColor: baseColor('gray-100')\n" +
    '### color\n' +
    'Resolves a Spectrum color token name to a CSS color value string. ' +
    'Supports opacity modifiers via the `color/opacity` syntax.\n' +
    "borderColor: color('accent-900/50')\n";
  return `${nav}${tokenList}${utilities}`;
}

const QUESTION = 'How do I use the accent color token with the style macro?';
const ANSWER =
  "Use the baseColor utility for stateful colors, e.g. baseColor('gray-100'). " +
  "For opacity use the color() utility with the token/opacity syntax: color('accent-900/50').";

describe('mapHitsToJudgeSources', () => {
  it('collapses repeated hits for the same record', () => {
    const hit = { objectID: 'abc', title: 'Style Macro', url: 'https://x/y', body: 'full text' };
    const sources = mapHitsToJudgeSources([hit, { ...hit }, { ...hit }]);

    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe('abc');
  });

  it('keeps the fullest copy when duplicates carry different amounts of text', () => {
    const sources = mapHitsToJudgeSources([
      { objectID: 'abc', title: 'T', body: 'short' },
      { objectID: 'abc', title: 'T', body: 'a much longer body with more detail' },
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0].text).toBe('a much longer body with more detail');
  });

  it('keeps genuinely distinct records', () => {
    const sources = mapHitsToJudgeSources([
      { objectID: 'a', body: 'one' },
      { objectID: 'b', body: 'two' },
    ]);

    expect(sources.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('preserves retrieval order', () => {
    const sources = mapHitsToJudgeSources([
      { objectID: 'a', body: 'one' },
      { objectID: 'b', body: 'two' },
      { objectID: 'a', body: 'one' },
      { objectID: 'c', body: 'three' },
    ]);

    expect(sources.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('excerptSources', () => {
  const BUDGET = 3000;

  it('surfaces the passage that supports the answer, not just the page head', () => {
    const doc = styleMacroLikeDoc();
    const [excerpt] = excerptSources([{ id: '1', text: doc }], QUESTION, ANSWER, BUDGET);

    // The claims under test must be verifiable from the excerpt.
    expect(excerpt.text).toContain('stateful color token references');
    expect(excerpt.text).toContain('color/opacity');
    expect(excerpt.text).toContain("color('accent-900/50')");
  });

  it('keeps the head of the source for context', () => {
    const doc = styleMacroLikeDoc();
    const [excerpt] = excerptSources([{ id: '1', text: doc }], QUESTION, ANSWER, BUDGET);

    expect(excerpt.text.startsWith('Select…\nStyle Macro')).toBe(true);
  });

  it('stays within the budget', () => {
    const doc = styleMacroLikeDoc();
    const [excerpt] = excerptSources([{ id: '1', text: doc }], QUESTION, ANSWER, BUDGET);

    expect(doc.length).toBeGreaterThan(10_000);
    expect(excerpt.text.length).toBeLessThanOrEqual(BUDGET);
  });

  it('leaves sources already within budget untouched', () => {
    const text = 'a short source that needs no excerpting';
    const [excerpt] = excerptSources([{ id: '1', text }], QUESTION, ANSWER, BUDGET);

    expect(excerpt.text).toBe(text);
  });

  it('falls back to head truncation when nothing matches', () => {
    const text = 'zzz '.repeat(2000);
    const [excerpt] = excerptSources([{ id: '1', text }], 'unrelated', 'nothing in common', BUDGET);

    expect(excerpt.text.endsWith('…')).toBe(true);
    expect(excerpt.text.length).toBeLessThanOrEqual(BUDGET + 1);
  });

  it('marks where text was skipped', () => {
    const doc = styleMacroLikeDoc();
    const [excerpt] = excerptSources([{ id: '1', text: doc }], QUESTION, ANSWER, BUDGET);

    expect(excerpt.text).toContain('…');
  });

  it('gives more of the budget to the source that can evidence the claims', () => {
    const relevant = styleMacroLikeDoc();
    const irrelevant = 'Tooltip guidance about placement and delay.\n'.repeat(400);

    const [a, b] = excerptSources(
      [
        { id: 'style-macro', text: relevant },
        { id: 'tooltip', text: irrelevant },
      ],
      QUESTION,
      ANSWER,
      8000,
    );

    expect(a.text.length).toBeGreaterThan(b.text.length);
    expect(a.text.length + b.text.length).toBeLessThanOrEqual(8000);
  });

  it('keeps both the value list and the prose that explain a claim', () => {
    const doc = styleMacroLikeDoc();
    const [excerpt] = excerptSources(
      [{ id: '1', text: doc }],
      QUESTION,
      `${ANSWER} Accent shades run accent-100 through accent-1600.`,
      BUDGET,
    );

    // Token names prove the values exist; the prose proves what the utility does.
    expect(excerpt.text).toContain('accent-1600');
    expect(excerpt.text).toContain('stateful color token references');
  });
});

/**
 * Regression cover for a grounding false-negative caused by the *default*
 * budget rather than by the selection within one source.
 *
 * Every source is charged MIN_SOURCE_CHARS (800) before relevance allocation
 * begins, so a 12-source retrieval spends 9600 characters on the floor alone.
 * When the total budget was cut to 12000 that left only ~2400 to distribute,
 * and the one page that could settle the answer's claims — 87KB of real
 * documentation — received 1502 characters. A token it documents 809
 * characters in was scored UNSUPPORTED at 100% certainty, dragging grounding
 * down while coverage, depth and relevance stayed high, because grounding is
 * the only dimension scored against the source text.
 *
 * The invariant is therefore about allocation, not about any single term: a
 * large, highly relevant source must win budget well clear of the floor when
 * retrieval is wide.
 */
describe('excerptSources at the default budget', () => {
  /** The one page that can evidence the answer, buried in a wide retrieval. */
  function wideRetrieval(): { id: string; text: string }[] {
    const relevant =
      styleMacroLikeDoc() +
      Array.from(
        { length: 400 },
        (_, i) => `The style macro resolves color token ${i} for a component property.`,
      ).join('\n');
    const filler = Array.from({ length: 11 }, (_, i) => ({
      id: `filler-${i}`,
      text: `# Component ${i}\nGuidance about color, style, spacing and usage.\n`.repeat(150),
    }));
    return [{ id: 'style-macro', text: relevant }, ...filler];
  }

  it('gives the page that can evidence the claims far more than the per-source floor', () => {
    const excerpts = excerptSources(wideRetrieval(), QUESTION, ANSWER);
    const styleMacro = excerpts.find((s) => s.id === 'style-macro');

    // MIN_SOURCE_CHARS is 800. At the 12000 budget that caused the regression
    // this source received well under 3000 characters of its ~40KB.
    expect(styleMacro?.text.length).toBeGreaterThan(5000);
  });

  it('still surfaces the supporting prose when retrieval is wide', () => {
    const excerpts = excerptSources(wideRetrieval(), QUESTION, ANSWER);
    const styleMacro = excerpts.find((s) => s.id === 'style-macro');

    expect(styleMacro?.text).toContain('stateful color token references');
    expect(styleMacro?.text).toContain("color('accent-900/50')");
  });
});
