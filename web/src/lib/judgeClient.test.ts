import { describe, it, expect } from 'vitest';
import { judgeAnswer, type JudgeVerdict } from './judgeClient';

function baseVerdict(): JudgeVerdict {
  return {
    panelId: 'main',
    dims: { usefulness: 8 },
    synthesizedScore: 8,
    composite: 8,
    preGateScore: 8,
    gateTripped: false,
    borderline: false,
    flaggedClaims: [],
    perJudge: [],
    rationale: 'fine',
  };
}

function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
}

describe('judgeAnswer — usage field tolerance (cost tracking §6, Phase 3)', () => {
  const input = { question: 'q', answer: 'a', hits: [] };

  it('folds request-scoped usage onto the returned verdict when the server sends it', async () => {
    const usage = {
      calls: [{ tag: 'judge:skeptic:round1', model: 'gemini-2.5-flash', inputTokens: 100, outputTokens: 20 }],
      totalInputTokens: 100,
      totalOutputTokens: 20,
      estimatedCostUsd: 0.00008,
    };
    const fetchImpl = mockFetch({ rounds: 1, panels: [baseVerdict()], usage });

    const verdict = await judgeAnswer(input, fetchImpl);

    expect(verdict.usage).toEqual(usage);
    expect(verdict.error).toBeUndefined();
  });

  it('never crashes and leaves usage undefined when an older deployment omits the field', async () => {
    const fetchImpl = mockFetch({ rounds: 1, panels: [baseVerdict()] }); // no `usage` key at all

    const verdict = await judgeAnswer(input, fetchImpl);

    expect(verdict.usage).toBeUndefined();
    expect(verdict.error).toBeUndefined();
    expect(verdict.composite).toBe(8);
  });

  it('leaves usage undefined on a network failure (error verdict path)', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const verdict = await judgeAnswer(input, fetchImpl);

    expect(verdict.error).toBeTruthy();
    expect(verdict.usage).toBeUndefined();
  });

  it('leaves usage undefined on a malformed JSON response', async () => {
    const fetchImpl = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;

    const verdict = await judgeAnswer(input, fetchImpl);

    expect(verdict.error).toBeTruthy();
    expect(verdict.usage).toBeUndefined();
  });
});

describe('judgeAnswer — Phase 2 rebuild verdict shape (usefulness + corroboration gate)', () => {
  const input = { question: 'q', answer: 'a', hits: [] };

  it('passes through the new 1-dim usefulness rubric + gate cluster fields unchanged', async () => {
    const verdict: JudgeVerdict = {
      panelId: 'main',
      dims: { usefulness: 6.5 },
      gateTripped: true,
      borderline: false,
      synthesizedScore: 3,
      composite: 3,
      preGateScore: 6.5,
      flaggedClaims: [
        {
          claim: 'Algolia guarantees 99.999% uptime',
          reason: 'no SLA is stated',
          certainty: 0.9,
          judgeIds: ['skeptic', 'referee'],
          sourceId: 'S1',
          excerpt: 'no SLA is stated',
          excerptVerified: true,
        },
      ],
      corroboratedClusters: [
        {
          representativeClaim: 'Algolia guarantees 99.999% uptime',
          judgeIds: ['skeptic', 'referee'],
          maxCertainty: 0.9,
          violations: [{ claim: 'Algolia guarantees 99.999% uptime', reason: 'no SLA is stated', certainty: 0.9 }],
        },
      ],
      soloFlags: [],
      perJudge: [],
      rationale: 'capped by corroborated flag',
    };
    const fetchImpl = mockFetch({ rounds: 1, panels: [verdict] });

    const out = await judgeAnswer(input, fetchImpl);

    expect(out.dims).toEqual({ usefulness: 6.5 });
    expect(out.flaggedClaims[0].judgeIds).toEqual(['skeptic', 'referee']);
    expect(out.flaggedClaims[0].excerptVerified).toBe(true);
    expect(out.corroboratedClusters).toHaveLength(1);
    expect(out.soloFlags).toEqual([]);
  });

  it('still resolves an old 4-dim verdict (no corroboratedClusters/soloFlags) without crashing', async () => {
    const verdict = { ...baseVerdict(), dims: { grounding: 7, coverage: 8, depth: 7, relevance: 8 } };
    const fetchImpl = mockFetch({ rounds: 1, panels: [verdict] });

    const out = await judgeAnswer(input, fetchImpl);

    expect(out.dims).toEqual({ grounding: 7, coverage: 8, depth: 7, relevance: 8 });
    expect(out.corroboratedClusters).toBeUndefined();
    expect(out.soloFlags).toBeUndefined();
    expect(out.error).toBeUndefined();
  });
});
