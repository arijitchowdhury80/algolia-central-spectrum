import { describe, it, expect } from 'vitest';
import { chipState } from './ConfidenceChip';
import type { JudgeVerdict } from '../lib/judgeClient';

/**
 * chipState decides what a PROSPECT reads on every answer, so each branch is
 * pinned. The rule it must never break: nothing displayed unless the judge
 * proved it, and no branch falls back to the composite decimal — that decimal
 * fuses one validated signal with three unvalidated ones and is not
 * reproducible run to run (measured {3.00, 8.89} on identical input).
 */
const verdict = (over: Partial<JudgeVerdict> = {}): JudgeVerdict => ({
  panelId: 'P1',
  dims: { usefulness: 8 },
  synthesizedScore: 8.9,
  composite: 8.9,
  preGateScore: 8.9,
  gateTripped: false,
  borderline: false,
  flaggedClaims: [],
  perJudge: [],
  rationale: '',
  ...over,
});

describe('chipState', () => {
  /**
   * Regression: the chip used to render NOTHING on an error verdict, so an
   * unreachable judge looked like the grounding feature had been removed.
   * Observed 2026-07-28 on a build with no VITE_JUDGE_URL (request to
   * localhost:8788 refused). Silence is the wrong failure mode.
   */
  it('renders a visible chip when the judge could not be reached', () => {
    const s = chipState(verdict({ error: 'Failed to fetch', grounded: undefined }));
    expect(s.label).toBe('Grounding');
    expect(s.detail).toBe("didn't run");
    expect(s.tone).toBe('muted');
    expect(s.title).toContain('Failed to fetch');
  });

  it('prefers the error state over any stale grounding fields on the same verdict', () => {
    const s = chipState(verdict({ error: 'HTTP 500', grounded: true, termsChecked: 9 }));
    expect(s.detail).toBe("didn't run");
  });

  it('reads Grounded, positive, when every checked term was located', () => {
    const s = chipState(verdict({ grounded: true, termsChecked: 9 }));
    expect(s.label).toBe('Grounded');
    expect(s.tone).toBe('positive');
    expect(s.title).toContain('9');
  });

  it('counts unverified claims and names them in the tooltip', () => {
    const s = chipState(
      verdict({
        grounded: false,
        termsChecked: 12,
        unsupportedTerms: [
          { term: 'QuantumTypoEngine', kind: 'component' },
          { term: '1.875', kind: 'number' },
        ],
      }),
    );
    expect(s.label).toBe('2 unverified claims');
    expect(s.tone).toBe('negative');
    expect(s.title).toContain('QuantumTypoEngine');
  });

  it('uses the singular for exactly one unverified claim', () => {
    const s = chipState(
      verdict({ grounded: false, termsChecked: 4, unsupportedTerms: [{ term: 'isFoo', kind: 'identifier' }] }),
    );
    expect(s.label).toBe('1 unverified claim');
  });

  it('distinguishes "nothing to verify" from "verified" on a prose-only answer', () => {
    // A refusal or pure-prose answer has no identifiers or figures to check.
    // Calling that "Grounded" would overstate what was actually proven.
    const s = chipState(verdict({ grounded: true, termsChecked: 0 }));
    expect(s.label).toBe('Grounding');
    expect(s.detail).toBe('nothing to verify');
    expect(s.tone).toBe('muted');
  });

  it('flags advisory judge findings without letting them change the verdict', () => {
    const s = chipState(
      verdict({
        grounded: true,
        termsChecked: 5,
        advisoryClusters: [{ representativeClaim: 'c', judgeIds: ['skeptic', 'referee'], maxCertainty: 0.9, violations: [] }],
      }),
    );
    expect(s.label).toBe('Grounded'); // verdict unchanged
    expect(s.detail).toBe('1 to review'); // but visible
    expect(s.tone).toBe('notice');
  });

  it('says "unavailable" on a judge build with no deterministic check — never the composite', () => {
    const s = chipState(verdict({ grounded: undefined, composite: 8.9 }));
    expect(s.detail).toBe('unavailable');
    expect(s.tone).toBe('muted');
    // The whole point: the decimal must not leak back in through a fallback.
    expect(`${s.label}${s.detail}${s.title}`).not.toContain('8.9');
  });

  it('never renders a score out of 10 in any branch', () => {
    const cases: JudgeVerdict[] = [
      verdict({ grounded: true, termsChecked: 5 }),
      verdict({ grounded: true, termsChecked: 0 }),
      verdict({ grounded: false, termsChecked: 5, unsupportedTerms: [{ term: 'x', kind: 'number' }] }),
      verdict({ grounded: undefined }),
    ];
    for (const v of cases) {
      const s = chipState(v);
      expect(`${s.label} ${s.detail ?? ''}`).not.toMatch(/\/\s*10/);
    }
  });
});
