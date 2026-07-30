import { describe, it, expect } from 'vitest';
import { CHAT_CACHE_EPOCH, purgeStaleChatCache } from './chatCache';

/** Minimal in-memory Storage stand-in — no DOM needed. */
function fakeStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

const CHAT_KEY_A = 'instantsearch-chat-initial-messages-95826da6';
const CHAT_KEY_B = 'instantsearch-chat-initial-messages-ae127977';

describe('purgeStaleChatCache', () => {
  it('purges every persisted chat history on a first-ever load', () => {
    const s = fakeStorage({ [CHAT_KEY_A]: '[]', [CHAT_KEY_B]: '[]' });
    const r = purgeStaleChatCache(s);
    expect(r.reason).toBe('epoch-changed');
    expect(r.purged.sort()).toEqual([CHAT_KEY_A, CHAT_KEY_B].sort());
    expect(s.getItem(CHAT_KEY_A)).toBeNull();
    expect(s.getItem('acs-chat-cache-epoch')).toBe(CHAT_CACHE_EPOCH);
  });

  it('is a no-op on a normal reload — the conversation survives', () => {
    const s = fakeStorage({ 'acs-chat-cache-epoch': CHAT_CACHE_EPOCH, [CHAT_KEY_A]: '[{"id":"1"}]' });
    const r = purgeStaleChatCache(s);
    expect(r.reason).toBe('up-to-date');
    expect(r.purged).toEqual([]);
    expect(s.getItem(CHAT_KEY_A)).toBe('[{"id":"1"}]'); // NOT dropped
  });

  it('purges again when the epoch is bumped', () => {
    const s = fakeStorage({ 'acs-chat-cache-epoch': 'older-epoch', [CHAT_KEY_A]: '[]' });
    const r = purgeStaleChatCache(s);
    expect(r.reason).toBe('epoch-changed');
    expect(r.purged).toEqual([CHAT_KEY_A]);
  });

  it('leaves unrelated keys alone', () => {
    const s = fakeStorage({ [CHAT_KEY_A]: '[]', 'some-other-app': 'keep me' });
    purgeStaleChatCache(s);
    expect(s.getItem('some-other-app')).toBe('keep me');
  });

  it('purges ALL chat keys, not just the first — index reshuffles on removal', () => {
    const s = fakeStorage({ [CHAT_KEY_A]: '[]', [CHAT_KEY_B]: '[]', [`${CHAT_KEY_A}-x`]: '[]' });
    const r = purgeStaleChatCache(s);
    expect(r.purged).toHaveLength(3);
    expect([...s._map.keys()]).toEqual(['acs-chat-cache-epoch']);
  });

  it('never throws when storage is missing or unusable', () => {
    expect(purgeStaleChatCache(undefined).reason).toBe('unavailable');
    const hostile = {
      length: 1,
      key: () => { throw new Error('blocked'); },
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    expect(purgeStaleChatCache(hostile).reason).toBe('unavailable');
  });
});
