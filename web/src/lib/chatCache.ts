/**
 * chatCache — drop persisted chat turns when they can no longer be trusted.
 *
 * THE PROBLEM (found 2026-07-28)
 * -----------------------------
 * `react-instantsearch`'s `useChat` persists the ENTIRE message history —
 * including each answer's raw search-tool results — into `sessionStorage` under
 * `instantsearch-chat-initial-messages-<agentId>`, and rehydrates it on every
 * page load (`getDefaultInitialMessages` reads that key unconditionally).
 *
 * That makes a corpus fix invisible. When the citation URLs in the index were
 * repaired, every already-rendered turn kept replaying its OLD hit payload, so
 * reloading the page brought back source pills pointing at raw markdown
 * downloads and titled with filename slugs. The index was correct; the screen
 * was not. It read as "the fix didn't work" — the worst kind of bug, because
 * the evidence of the fix is exactly what's being hidden.
 *
 * THE FIX
 * -------
 * Version the persisted history. `CHAT_CACHE_EPOCH` is bumped by hand whenever
 * something changes that makes previously-captured turns misleading — the shape
 * of a record, what a citation URL points at, which fields the judge returns.
 * On load, a mismatch purges the persisted turns so the user sees current data.
 *
 * A normal reload with an unchanged epoch still restores the conversation: this
 * only discards history that would now lie.
 */

/**
 * Bump this when previously-captured turns would misrepresent current data.
 *
 * History:
 *  - `2026-07-28-citation-urls` — SpectrumDesignDocs citations moved off
 *    raw.githubusercontent markdown downloads onto real docs pages, and titles
 *    moved off filename slugs. Turns captured before this replay the old url +
 *    title, which is precisely the bug users would report as unfixed.
 */
export const CHAT_CACHE_EPOCH = '2026-07-28-citation-urls';

/** Our own marker. Namespaced so it can never collide with the library's keys. */
const EPOCH_KEY = 'acs-chat-cache-epoch';

/** The library's persistence key prefix (react-instantsearch `CACHE_KEY`). */
const IS_CHAT_PREFIX = 'instantsearch-chat-initial-messages';

/**
 * Purge persisted chat turns iff the epoch changed. Pure w.r.t. the injected
 * storage so it is testable without a DOM; returns what it removed so a caller
 * (or a test) can assert on it rather than infer.
 *
 * Deliberately tolerant: a browser with sessionStorage disabled or a quota
 * error must never break app startup over a cache-hygiene concern.
 */
export function purgeStaleChatCache(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | undefined,
  epoch: string = CHAT_CACHE_EPOCH,
): { purged: string[]; reason: 'epoch-changed' | 'up-to-date' | 'unavailable' } {
  if (!storage) return { purged: [], reason: 'unavailable' };
  try {
    if (storage.getItem(EPOCH_KEY) === epoch) return { purged: [], reason: 'up-to-date' };

    // Collect first: removing while iterating by index reshuffles the keys.
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(IS_CHAT_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) storage.removeItem(k);
    storage.setItem(EPOCH_KEY, epoch);
    return { purged: doomed, reason: 'epoch-changed' };
  } catch {
    return { purged: [], reason: 'unavailable' };
  }
}
