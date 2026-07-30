import { describe, it, expect } from 'vitest';
import { messagesToTurns } from './chatTurns';
import type { ChatMessageLike } from './chatMessage';

const user = (id: string, text: string): ChatMessageLike => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
});
const assistant = (id: string, text: string, extra: ChatMessageLike['parts'] = []): ChatMessageLike => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text }, ...extra],
});

describe('messagesToTurns', () => {
  it('empty messages → no turns', () => {
    expect(messagesToTurns([], 'ready')).toEqual([]);
  });

  it('pairs a user question with its assistant answer into one Generic turn', () => {
    const turns = messagesToTurns([user('u1', 'q1'), assistant('a1', 'answer one')], 'ready');
    expect(turns).toHaveLength(1);
    expect(turns[0].query).toBe('q1');
    expect(turns[0].segments[0]).toMatchObject({ agent: 'generic', status: 'success', text: 'answer one' });
    expect(turns[0].id).toBe('a1');
  });

  it('extracts grounded sources + searchCount from the assistant tool-output part', () => {
    const a = assistant('a1', 'grounded answer', [
      {
        type: 'tool-algolia_search_index',
        state: 'output-available',
        output: { hits: [{ objectID: 'o1', title: 'ComboBox', url: 'https://x/c', source: 'ReactSpectrumS2' }] },
      },
    ]);
    const turns = messagesToTurns([user('u1', 'q'), a], 'ready');
    expect(turns[0].segments[0].sources).toHaveLength(1);
    expect(turns[0].segments[0].sources[0]).toMatchObject({ title: 'ComboBox', source: 'ReactSpectrumS2' });
    expect(turns[0].segments[0].searchCount).toBeGreaterThan(0);
  });

  it('only the latest turn reflects live status; earlier turns are success', () => {
    const msgs = [user('u1', 'q1'), assistant('a1', 'a1'), user('u2', 'q2'), assistant('a2', 'partial')];
    const turns = messagesToTurns(msgs, 'streaming');
    expect(turns[0].segments[0].status).toBe('success'); // earlier turn done
    expect(turns[1].segments[0].status).toBe('streaming'); // latest turn live
  });

  it('a user message with no assistant yet → loading shell', () => {
    const turns = messagesToTurns([user('u1', 'q1')], 'submitted');
    expect(turns[0].segments[0].status).toBe('loading');
    expect(turns[0].segments[0].text).toBe('');
  });

  it('error status on the latest turn surfaces as error segment', () => {
    const turns = messagesToTurns([user('u1', 'q1'), assistant('a1', 'half')], 'error');
    expect(turns[0].segments[0].status).toBe('error');
  });
});
