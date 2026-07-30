import { describe, it, expect } from 'vitest';
import {
  answerText,
  sourcesFromParts,
  rawHitsFromParts,
  questionFromMessages,
  canClassify,
  type ChatMessagePart,
  type ChatMessageLike,
} from './chatMessage';

describe('answerText', () => {
  it('returns empty string for empty parts', () => {
    expect(answerText([])).toBe('');
  });

  it('joins a single text part unchanged (trimmed)', () => {
    const parts: ChatMessagePart[] = [{ type: 'text', text: '  hello there  ' }];
    expect(answerText(parts)).toBe('hello there');
  });

  it('joins multiple text parts with a blank line, skipping non-text parts', () => {
    const parts: ChatMessagePart[] = [
      { type: 'text', text: 'first part' },
      { type: 'tool-algolia_search_index', state: 'output-available', output: { hits: [] } },
      { type: 'text', text: 'second part' },
    ];
    expect(answerText(parts)).toBe('first part\n\nsecond part');
  });

  it('drops whitespace-only text parts', () => {
    const parts: ChatMessagePart[] = [
      { type: 'text', text: 'real text' },
      { type: 'text', text: '   ' },
    ];
    expect(answerText(parts)).toBe('real text');
  });
});

describe('sourcesFromParts', () => {
  it('returns empty array for empty parts', () => {
    expect(sourcesFromParts([])).toEqual([]);
  });

  it('returns empty array when parts carry no source-bearing entries (text-only)', () => {
    const parts: ChatMessagePart[] = [{ type: 'text', text: 'just an answer, no citations' }];
    expect(sourcesFromParts(parts)).toEqual([]);
  });

  it('extracts a source-url part as an AnswerSource', () => {
    const parts: ChatMessagePart[] = [
      { type: 'text', text: 'answer' },
      { type: 'source-url', sourceId: 'src-1', url: 'https://example.com/a', title: 'Page A' },
    ];
    const sources = sourcesFromParts(parts);
    expect(sources).toEqual([{ id: 'src-1', title: 'Page A', url: 'https://example.com/a', source: undefined }]);
  });

  it('extracts a source-document part (no url) as an AnswerSource', () => {
    const parts: ChatMessagePart[] = [
      { type: 'source-document', sourceId: 'doc-1', title: 'Doc Title' },
    ];
    expect(sourcesFromParts(parts)).toEqual([{ id: 'doc-1', title: 'Doc Title', url: undefined, source: undefined }]);
  });

  it('extracts hits from a tool-output part, normalized like an agentStudio hit', () => {
    const parts: ChatMessagePart[] = [
      { type: 'text', text: 'answer text' },
      {
        type: 'tool-algolia_search_index',
        state: 'output-available',
        output: {
          hits: [
            { objectID: 'obj-1', title: 'Hit One', url: 'https://example.com/1', source: 'ReactSpectrumS2' },
            { objectID: 'obj-2', title: 'Hit Two' },
          ],
        },
      },
    ];
    expect(sourcesFromParts(parts)).toEqual([
      { id: 'obj-1', title: 'Hit One', url: 'https://example.com/1', source: 'ReactSpectrumS2' },
      { id: 'obj-2', title: 'Hit Two', url: undefined, source: undefined },
    ]);
  });

  it('ignores a tool part still streaming (state !== output-available)', () => {
    const parts: ChatMessagePart[] = [
      { type: 'tool-algolia_search_index', state: 'input-streaming' as never, output: undefined },
    ];
    expect(sourcesFromParts(parts)).toEqual([]);
  });

  it('drops a hit with neither title nor url (defensive, matches normalizeHit)', () => {
    const parts: ChatMessagePart[] = [
      {
        type: 'tool-algolia_search_index',
        state: 'output-available',
        output: { hits: [{ objectID: 'obj-empty' }] },
      },
    ];
    expect(sourcesFromParts(parts)).toEqual([]);
  });
});

describe('rawHitsFromParts', () => {
  it('returns empty array for empty parts', () => {
    expect(rawHitsFromParts([])).toEqual([]);
  });

  it('returns empty array when there is no tool-output part (text + source-url only)', () => {
    const parts: ChatMessagePart[] = [
      { type: 'text', text: 'answer' },
      { type: 'source-url', sourceId: 'src-1', url: 'https://example.com/a', title: 'Page A' },
    ];
    expect(rawHitsFromParts(parts)).toEqual([]);
  });

  it('returns the raw (un-normalized) hits from a tool-output part', () => {
    const rawHit = { objectID: 'obj-1', title: 'Hit One', body: 'full body text for grounding' };
    const parts: ChatMessagePart[] = [
      { type: 'tool-algolia_search_index', state: 'output-available', output: { hits: [rawHit] } },
    ];
    expect(rawHitsFromParts(parts)).toEqual([rawHit]);
  });
});

describe('questionFromMessages', () => {
  const userMsg = (id: string, text: string): ChatMessageLike => ({
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  });
  const assistantMsg = (id: string, text: string): ChatMessageLike => ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text }],
  });

  it('returns the user question immediately preceding the assistant message', () => {
    const messages = [userMsg('u1', 'What are accent tokens?'), assistantMsg('a1', 'They are...')];
    expect(questionFromMessages(messages, 'a1')).toBe('What are accent tokens?');
  });

  it('pairs the correct question in a multi-turn transcript (walks back, not last-user)', () => {
    const messages = [
      userMsg('u1', 'first question'),
      assistantMsg('a1', 'first answer'),
      userMsg('u2', 'second question'),
      assistantMsg('a2', 'second answer'),
    ];
    expect(questionFromMessages(messages, 'a1')).toBe('first question');
    expect(questionFromMessages(messages, 'a2')).toBe('second question');
  });

  it('returns empty string when the assistant id is not found', () => {
    expect(questionFromMessages([userMsg('u1', 'q')], 'missing')).toBe('');
  });

  it('returns empty string when there is no preceding user message', () => {
    expect(questionFromMessages([assistantMsg('a1', 'orphan answer')], 'a1')).toBe('');
  });
});

describe('canClassify', () => {
  it('true only when not aborted/errored and both text and question are non-empty', () => {
    expect(canClassify({ text: 'answer', question: 'q' })).toBe(true);
  });
  it('false when aborted', () => {
    expect(canClassify({ isAbort: true, text: 'answer', question: 'q' })).toBe(false);
  });
  it('false when errored', () => {
    expect(canClassify({ isError: true, text: 'answer', question: 'q' })).toBe(false);
  });
  it('false on empty answer text', () => {
    expect(canClassify({ text: '   ', question: 'q' })).toBe(false);
  });
  it('false on empty question', () => {
    expect(canClassify({ text: 'answer', question: '' })).toBe(false);
  });
});
