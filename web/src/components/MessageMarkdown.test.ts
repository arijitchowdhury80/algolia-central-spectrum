import { describe, it, expect } from 'vitest';
import { groupIntoRuns } from './MessageMarkdown';

/**
 * Observed on production /app 2026-07-30: an answer emitted
 * `### Key Features and Options` and the page displayed the hashes literally,
 * because the line matched no list rule and fell through to the prose path.
 * These pin the classification, which is where that bug lived — the styling
 * decision on top of it is not what broke.
 */
describe('groupIntoRuns — headings', () => {
  it('classifies an ATX heading as a heading, not prose', () => {
    expect(groupIntoRuns('### Key Features and Options')).toEqual([
      { kind: 'heading', lines: ['### Key Features and Options'] },
    ]);
  });

  it('accepts every heading level a model actually emits', () => {
    for (const hashes of ['#', '##', '###', '####', '#####', '######']) {
      expect(groupIntoRuns(`${hashes} Title`)[0].kind).toBe('heading');
    }
  });

  it('keeps consecutive headings separate rather than merging them into one run', () => {
    const runs = groupIntoRuns('## Section\n### Subsection');
    expect(runs.map((r) => r.kind)).toEqual(['heading', 'heading']);
    expect(runs[1].lines).toEqual(['### Subsection']);
  });

  it('leaves a hash that is not a heading as prose', () => {
    // No space after the hashes, and a mid-sentence '#', are both prose. The
    // second case matters: '#1' in an answer must not become a heading.
    expect(groupIntoRuns('#NotAHeading')[0].kind).toBe('prose');
    expect(groupIntoRuns('Use variant #1 for this')[0].kind).toBe('prose');
  });

  it('still splits a heading followed by its list, in one block', () => {
    const runs = groupIntoRuns('### Sizes\n- small\n- medium');
    expect(runs.map((r) => r.kind)).toEqual(['heading', 'bullet']);
    expect(runs[1].lines).toHaveLength(2);
  });

  it('does not regress the intro-sentence-then-numbered-list grouping', () => {
    const runs = groupIntoRuns("Here's the process:\n1. Do X\n2. Do Y");
    expect(runs.map((r) => r.kind)).toEqual(['prose', 'ordered']);
  });
});
