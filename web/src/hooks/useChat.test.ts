import { describe, it, expect, vi } from 'vitest';
// Vite's `?raw` import loads the file's own source as a string — no Node
// filesystem API needed (this repo has no `@types/node` dependency; adding
// one for a single test's sake isn't a call this task makes unilaterally).
import useChatSource from './useChat.ts?raw';
import {
  extractDeepDiveOffer,
  deriveOfferState,
  buildTechnicalHistory,
  summarizeForHistory,
  summarizeSegmentsForHistory,
  turnToHistory,
  resolveOfferPatch,
} from './useChat';
import type { AnswerSegment, ChatTurn } from '../types';
import type { CompletionsConfig } from '../lib/agentStudio';

vi.mock('../lib/classifier', () => ({
  classifyOffer: vi.fn(),
}));

import { classifyOffer } from '../lib/classifier';

const mockClassifyOffer = classifyOffer as unknown as ReturnType<typeof vi.fn>;

const fakeClassifierConfig: CompletionsConfig = {
  appId: 'app-id',
  searchKey: 'search-key',
  agentId: 'classifier-agent-id',
};

describe('extractDeepDiveOffer', () => {
  it('isolates the first SPECIALIST: entry and strips it from rest', () => {
    expect(extractDeepDiveOffer(['SPECIALIST: foo bar', 'unrelated'])).toEqual({
      offer: 'foo bar',
      rest: ['unrelated'],
    });
  });

  it('returns { rest: suggestions } unchanged when no SPECIALIST: entry exists', () => {
    const result = extractDeepDiveOffer(['just a follow-up']);
    expect(result.offer).toBeUndefined();
    expect(result.rest).toEqual(['just a follow-up']);
  });

  it('tolerates leading whitespace + mixed casing, preserving the offer text casing (WR-02)', () => {
    expect(extractDeepDiveOffer([' Specialist: Show me the Button API', 'x'])).toEqual({
      offer: 'Show me the Button API',
      rest: ['x'],
    });
  });
});

describe('deriveOfferState', () => {
  it('sets deepDiveOffered/followUp/deepDiveQuery together when an offer exists', () => {
    expect(deriveOfferState(['SPECIALIST: x', 'y'], 'my question')).toEqual({
      deepDiveOffered: true,
      followUp: 'y',
      deepDiveQuery: 'my question',
    });
  });

  it('leaves deepDiveOffered false and deepDiveQuery undefined when no offer', () => {
    expect(deriveOfferState(['y'], 'my question')).toEqual({
      deepDiveOffered: false,
      followUp: 'y',
      deepDiveQuery: undefined,
    });
  });
});

describe('buildTechnicalHistory (double-user-turn regression)', () => {
  it("uses the query alone as the user entry, never query + generic's answer", () => {
    const genericText = "the generic agent's full answer text";
    const history = buildTechnicalHistory([], 'the question', genericText);
    const userEntry = history.find((e) => e.role === 'user');
    expect(userEntry?.content).toBe('the question');
    expect(userEntry?.content).not.toBe('the question' + genericText);
  });
});

describe('summarizeForHistory (R11 deterministic truncation)', () => {
  it('returns short text unchanged', () => {
    expect(summarizeForHistory('short text')).toBe('short text');
  });

  it('truncates at a word boundary and appends an ellipsis, never mid-word', () => {
    const original = 'word '.repeat(80); // 400 chars
    const result = summarizeForHistory(original);
    expect(result.length).toBeLessThanOrEqual(240);
    expect(result.endsWith(' …')).toBe(true);
    // The content before ' …' ends at a whitespace boundary in the original:
    // the character in the original immediately after the kept content is a space.
    const content = result.slice(0, -2);
    expect(original.charAt(content.length)).toBe(' ');
  });

  it('returns empty string unchanged', () => {
    expect(summarizeForHistory('')).toBe('');
  });

  it('leaves an exactly-240 string unchanged (strictly-greater-than check)', () => {
    const exactly240 = 'x'.repeat(240);
    expect(summarizeForHistory(exactly240)).toBe(exactly240);
  });
});

describe('summarizeSegmentsForHistory (WR-01 segment-aware budgets)', () => {
  it('keeps BOTH segments alive with realistic (600+ char) Generic + Technical text', () => {
    const generic = 'generic-alpha '.repeat(45); // 630 chars
    const technical = 'technical-omega '.repeat(40); // 640 chars
    const result = summarizeSegmentsForHistory([generic, technical]);
    expect(result.length).toBeLessThanOrEqual(240);
    // The bug this guards: end-truncating the flat join dropped Technical entirely.
    expect(result).toContain('generic-alpha');
    expect(result).toContain('technical-omega');
  });

  it('is identical to summarizeForHistory for a single segment', () => {
    const only = 'word '.repeat(80); // 400 chars
    expect(summarizeSegmentsForHistory([only])).toBe(summarizeForHistory(only));
  });
});

describe('turnToHistory (R11 verbatim question, summarized answer)', () => {
  it('preserves both the Generic and Technical answer in a realistic deep-dive turn (WR-01)', () => {
    const generic: AnswerSegment = {
      agent: 'generic',
      status: 'success',
      text: 'generic-alpha '.repeat(45), // 630 chars
      sources: [],
      searchCount: 0,
    };
    const technical: AnswerSegment = {
      agent: 'technical',
      status: 'success',
      text: 'technical-omega '.repeat(40), // 640 chars
      sources: [],
      searchCount: 0,
    };
    const turn: ChatTurn = {
      id: 't-deep',
      query: 'a real question',
      handoff: true,
      deepDiveOffered: false,
      segments: [generic, technical],
    };
    const assistantEntry = turnToHistory(turn).find((e) => e.role === 'assistant');
    expect(assistantEntry!.content.length).toBeLessThanOrEqual(240);
    expect(assistantEntry!.content).toContain('generic-alpha');
    expect(assistantEntry!.content).toContain('technical-omega');
  });

  it('keeps the query verbatim while summarizing the combined answer', () => {
    const query = 'What exactly is the question the user asked, verbatim?';
    const generic: AnswerSegment = {
      agent: 'generic',
      status: 'success',
      text: 'generic answer '.repeat(12), // 180 chars
      sources: [],
      searchCount: 0,
    };
    const technical: AnswerSegment = {
      agent: 'technical',
      status: 'success',
      text: 'technical deep-dive answer '.repeat(8), // 216 chars
      sources: [],
      searchCount: 0,
    };
    const turn: ChatTurn = {
      id: 't1',
      query,
      handoff: true,
      deepDiveOffered: false,
      segments: [generic, technical],
    };
    const history = turnToHistory(turn);
    const userEntry = history.find((e) => e.role === 'user');
    const assistantEntry = history.find((e) => e.role === 'assistant');
    expect(userEntry?.content).toBe(query);
    expect(assistantEntry).toBeDefined();
    expect(assistantEntry!.content.length).toBeLessThanOrEqual(240);
  });
});

describe('resolveOfferPatch (Go/No-Go item 1 — no genericResult.suggestions param exists to leak)', () => {
  it("forwards classifyOffer's resolved array into deriveOfferState untouched", async () => {
    mockClassifyOffer.mockReset();
    mockClassifyOffer.mockResolvedValueOnce(['SPECIALIST: x', 'y']);

    const result = await resolveOfferPatch(
      fakeClassifierConfig,
      'my question',
      'generic answer text',
      [],
    );

    expect(result).toEqual(deriveOfferState(['SPECIALIST: x', 'y'], 'my question'));
    expect(result).toEqual({
      deepDiveOffered: true,
      followUp: 'y',
      deepDiveQuery: 'my question',
    });
  });

  it('degrades to "no offer this turn" and never rethrows when classifyOffer fails', async () => {
    mockClassifyOffer.mockReset();
    mockClassifyOffer.mockRejectedValueOnce(new Error('classifier unavailable'));

    const result = await resolveOfferPatch(
      fakeClassifierConfig,
      'my question',
      'generic answer text',
      [],
    );

    expect(result).toEqual(deriveOfferState([], 'my question'));
    expect(result).toEqual({
      deepDiveOffered: false,
      followUp: undefined,
      deepDiveQuery: undefined,
    });
  });
});

describe('runTurn classifier call-site (Go/No-Go item 2 — target agent named explicitly)', () => {
  it('calls getAgentConfig with activeInstance.agents.classifier.id, not generic.id, at the resolveOfferPatch call site', () => {
    // Hook-level mocking of a live `useChat()` call requires React test infra
    // this repo deliberately doesn't add for one hook (see 05-plan.md Task A7).
    // Source-level assertion on the literal call site is the plan's explicitly
    // sanctioned alternative — cheap, deterministic, and fails the instant
    // runTurn's classifier wiring regresses back to generic.id or any other id.
    expect(useChatSource).toContain('getAgentConfig(activeInstance.agents.classifier.id)');
    expect(useChatSource).not.toMatch(
      /resolveOfferPatch\(\s*getAgentConfig\(activeInstance\.agents\.generic\.id\)/,
    );
  });
});
