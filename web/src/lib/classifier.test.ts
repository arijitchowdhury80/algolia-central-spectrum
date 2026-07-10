import { describe, expect, it, vi } from 'vitest';
import { buildClassificationQuery, parseClassifierResponse, classifyOffer } from './classifier';
import { callWithRetry } from './agentStudio';
import type { CompletionsConfig } from './agentStudio';

// classifier.ts calls callWithRetry (now moved to agentStudio.ts, Task A6/Gap
// 3) for its transport — mock it so this suite never hits the network.
vi.mock('./agentStudio', () => ({
  callWithRetry: vi.fn(),
}));

/**
 * Fixtures for tests 2/3/5 are pasted VERBATIM from Task A5's real captured
 * live probe (docs/spikes/2026-07-10-classifier-probe-implementation.txt and
 * docs/spikes/2026-07-10-classifier-probe-design.txt). Do not synthesize
 * these — same discipline agentStudio.test.ts already established for its
 * own real captured suggestion frames ("Do not synthesize these — the whole
 * point of B4 was that the wire shape ≠ the docs shape").
 */
const IMPLEMENTATION_CAPTURE =
  'SPECIALIST: Can you provide an example of implementing custom validation using the `validate` prop for a Spectrum S2 TextField?';
const DESIGN_CAPTURE =
  "Since you're evaluating design systems, would you be interested in learning how React Spectrum's unified API for collection components supports dynamic data, async loading, and virtualization?";

describe('buildClassificationQuery', () => {
  it('assembles the pinned QUESTION / GENERIC\'S ANSWER / RETRIEVED HITS delimited shape', () => {
    const result = buildClassificationQuery('a question', 'an answer', [{ title: 'X' }]);
    expect(result).toContain('QUESTION:\na question');
    expect(result).toContain("GENERIC'S ANSWER:\nan answer");
    expect(result).toContain('RETRIEVED HITS (JSON):\n[{"title":"X"}]');
  });
});

describe('parseClassifierResponse', () => {
  it('parses a real captured implementation-question response into a one-element SPECIALIST-prefixed array', () => {
    const result = parseClassifierResponse(IMPLEMENTATION_CAPTURE);
    expect(result).toHaveLength(1);
    expect(result[0].startsWith('SPECIALIST:')).toBe(true);
    expect(result).toEqual([IMPLEMENTATION_CAPTURE]);
  });

  it('parses a real captured design-question response into a one-element array with no SPECIALIST prefix', () => {
    const result = parseClassifierResponse(DESIGN_CAPTURE);
    expect(result).toHaveLength(1);
    expect(result[0].toUpperCase().startsWith('SPECIALIST:')).toBe(false);
    expect(result).toEqual([DESIGN_CAPTURE]);
  });

  it('returns [] on whitespace-only or empty input, never throws', () => {
    expect(parseClassifierResponse('  ')).toEqual([]);
    expect(parseClassifierResponse('')).toEqual([]);
  });
});

describe('classifyOffer', () => {
  it('returns the real offer text and calls callWithRetry with history:[] and the composite query, targeting the given config', async () => {
    const mockedCallWithRetry = vi.mocked(callWithRetry);
    mockedCallWithRetry.mockResolvedValue({
      content: IMPLEMENTATION_CAPTURE,
      toolInvocations: [],
      hits: [],
      suggestions: [],
    });

    const config: CompletionsConfig = {
      appId: 'app-id',
      searchKey: 'search-key',
      agentId: 'classifier-agent-id',
    };
    const hits = [{ title: 'real hit' }];
    const result = await classifyOffer(config, 'a real question', 'the generic answer', hits);

    expect(result).toEqual([IMPLEMENTATION_CAPTURE]);
    expect(mockedCallWithRetry).toHaveBeenCalledWith(config, {
      history: [],
      query: buildClassificationQuery('a real question', 'the generic answer', hits),
    });
  });
});
