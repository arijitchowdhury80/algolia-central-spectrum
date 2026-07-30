import { describe, it, expect } from 'vitest';
import { estimateAgentCost } from './costEstimate';

describe('estimateAgentCost', () => {
  it('estimates ~chars/4 tokens for question+sources (input) and answer (output)', () => {
    const question = 'a'.repeat(40); // 10 tokens
    const answer = 'b'.repeat(80); // 20 tokens
    const est = estimateAgentCost({ question, answer });
    expect(est.estimatedInputTokens).toBe(10);
    expect(est.estimatedOutputTokens).toBe(20);
    expect(est.method).toBe('ESTIMATED');
    expect(est.model).toBe('gemini-2.5-flash');
  });

  it('folds sourcesText into the input side', () => {
    const withoutSources = estimateAgentCost({ question: 'q'.repeat(8), answer: '' });
    const withSources = estimateAgentCost({
      question: 'q'.repeat(8),
      answer: '',
      sourcesText: ['s'.repeat(40)],
    });
    expect(withSources.estimatedInputTokens).toBeGreaterThan(withoutSources.estimatedInputTokens);
  });

  it('prices input and output independently at the gemini-2.5-flash rate ($0.30/$2.50 per 1M)', () => {
    const est = estimateAgentCost({
      question: 'x'.repeat(4_000_000), // 1,000,000 input tokens
      answer: 'y'.repeat(4_000_000), // 1,000,000 output tokens
    });
    expect(est.estimatedCostUsd).toBeCloseTo(0.3 + 2.5, 4);
  });

  it('empty question/answer/sources costs exactly zero, no NaN', () => {
    const est = estimateAgentCost({ question: '', answer: '' });
    expect(est.estimatedInputTokens).toBe(0);
    expect(est.estimatedOutputTokens).toBe(0);
    expect(est.estimatedCostUsd).toBe(0);
  });

  it('rounds token counts up (never underclaims a fraction of a token)', () => {
    const est = estimateAgentCost({ question: 'ab', answer: '' }); // 2 chars / 4 = 0.5 -> 1
    expect(est.estimatedInputTokens).toBe(1);
  });
});
