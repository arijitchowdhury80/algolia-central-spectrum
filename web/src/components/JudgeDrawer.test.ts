import { describe, it, expect } from 'vitest';
import { orderedDims } from './JudgeDrawer';

/**
 * orderedDims is the tolerant-Record mapping that must render sensibly
 * against BOTH the new Phase 2 rebuild (1-dim `usefulness`) response shape
 * AND the retired 4-dim (`grounding`/`coverage`/`depth`/`relevance`) shape —
 * so the drawer never crashes on a mismatched judge deployment.
 */
describe('orderedDims', () => {
  it('renders the new 1-dim usefulness shape with its friendly label', () => {
    const out = orderedDims({ usefulness: 7.2 });
    expect(out).toEqual([{ key: 'usefulness', label: 'Usefulness', score: 7.2 }]);
  });

  it('still renders the retired 4-dim shape (old judge / frozen fixture) without crashing', () => {
    const out = orderedDims({ grounding: 6, coverage: 7, depth: 8, relevance: 7.5 });
    expect(out.map((d) => d.key)).toEqual(['grounding', 'coverage', 'depth', 'relevance']);
    expect(out.every((d) => Number.isFinite(d.score))).toBe(true);
  });

  it('falls back to the raw key for an unknown dimension id (never drops it)', () => {
    const out = orderedDims({ someNewDim: 5 });
    expect(out).toEqual([{ key: 'someNewDim', label: 'someNewDim', score: 5 }]);
  });

  it('drops non-finite scores rather than rendering NaN', () => {
    const out = orderedDims({ usefulness: Number.NaN, grounding: 4 });
    expect(out.map((d) => d.key)).toEqual(['grounding']);
  });
});
